/**
 * Simulation on vertep: every run is one actor in a memory `ActorSystem` with a journal, and
 * every step the designer shows is what vertep reports (configuration and context from
 * snapshots, taken transitions from `onTransition` and the journal, enabled events from
 * `can`). The designer computes no transition.
 *
 * Steps are journal positions: step 0 is the initial configuration, step n the state after
 * the n-th journal entry (one macrostep per accepted event). Time travel reads past steps with
 * `asOf`. Sending an event while an earlier step is shown forks: `@vertep/web` exposes no fork
 * call, so a fork is a fresh actor of the same chart that is sent the run's events up to that
 * step (vertep is deterministic) and then the new event; the original run stays selectable.
 */
// @tg: implements:: [[openspec:chart-simulation#Simulation runs on the vertep interpreter]]
// @tg: implements:: [[openspec:chart-simulation#Start and reset]]
// @tg: implements:: [[openspec:chart-simulation#Enabled events are offered]]
// @tg: implements:: [[openspec:chart-simulation#Send events with payload]] {confidence: partial, note: "payload types are checked for typed YAML charts only"}
// @tg: implements:: [[openspec:chart-simulation#Context is shown]]
// @tg: implements:: [[openspec:chart-simulation#Event log]] {confidence: partial, note: "internal events are inferred"}
// @tg: implements:: [[openspec:chart-simulation#Time travel]] {confidence: partial, note: "forks replay the event prefix; vertep's fork is not exposed by @vertep/web"}
// @tg: implements:: [[openspec:chart-simulation#Live edits during simulation]]
// @tg: implements:: [[openspec:chart-simulation#Final state ends the run]] {confidence: partial, note: "done data is not exposed by @vertep/web"}
// @tg: implements:: [[openspec:chart-simulation#Active configuration is highlighted]] {confidence: partial, note: "the data: configuration and taken transitions"}

import { type ActorRef, type ActorSystem, type JournalEntry, type JsonValue, type Snapshot, VertepError } from "@vertep/web";
import { type Context, changedKeys, normalizeContext } from "./context.js";
import { type BuildKind, type EngineOptions, type Format, SystemPool, buildFor, declaredDatamodel } from "./engine.js";
import { PayloadTypeError, SimulationError } from "./errors.js";
import { PayloadChecker } from "./payload.js";
import {
  type InternalEvent,
  type TakenTransition,
  type TransitionIndex,
  decodeTransitionIri,
  defaultTransitionIndex,
  inferInternalEvents,
} from "./transitions.js";
import { type Violation, normalizeViolation } from "./violations.js";

/** The event of a macrostep. */
export interface StepEvent {
  readonly name: string;
  /** The payload as vertep journaled it (`null` when none). */
  readonly data: JsonValue | null;
  /** `external`: sent by the user; `timer`: a delayed `<send>` vertep delivered. */
  readonly origin: "external" | "timer";
}

/** One macrostep of a run: an entry of the event log. */
export interface LogEntry {
  /** The journal position (1 for the first macrostep). */
  readonly step: number;
  readonly event: StepEvent;
  /** Internal events of the macrostep, inferred from the transitions vertep took. */
  readonly internal: readonly InternalEvent[];
  /** The transitions vertep took, in order. */
  readonly transitions: readonly TakenTransition[];
  /** The configuration after the macrostep, as vertep reports it (document order). */
  readonly configuration: readonly string[];
  /** The context after the macrostep. */
  readonly context: Context;
  /** Context keys whose values the macrostep changed. */
  readonly changed: readonly string[];
  /** Whether the session terminated (a top-level final state was reached). */
  readonly terminated: boolean;
  /** The step was replayed into this run (a fork's prefix or a replay after an edit). */
  readonly replayed: boolean;
  readonly timestamp: number;
  readonly messageId: string;
}

/** What the designer shows for the step being viewed. */
export interface RunState {
  readonly runId: string;
  /** The viewed step (0: the initial configuration). */
  readonly step: number;
  /** The latest step of the run. */
  readonly head: number;
  /** Whether the latest step is viewed (sending appends rather than forks). */
  readonly live: boolean;
  /** Active state ids (document order). Empty once the session terminated. */
  readonly configuration: readonly string[];
  readonly context: Context;
  /** Context keys changed by the viewed step's macrostep. */
  readonly changed: readonly string[];
  /** The transitions the viewed step's macrostep took. */
  readonly transitions: readonly TakenTransition[];
  /** The internal events of the viewed step's macrostep (inferred). */
  readonly internal: readonly InternalEvent[];
  /** The event of the viewed step; null at step 0. */
  readonly event: StepEvent | null;
  /** A top-level final state was reached: no more events until reset or time travel. */
  readonly done: boolean;
  /**
   * The done data of the final state. Always undefined: `@vertep/web` does not report it
   * (snapshots carry no done data, and a top-level session has no parent to send it to).
   */
  readonly doneData: JsonValue | undefined;
  /** When done: the states the final macrostep entered (vertep reports an empty configuration). */
  readonly finalStates: readonly string[];
  /** The chart version IRI the run executes. */
  readonly version: string;
  /** The chart was edited since the run started: offer `replay`. */
  readonly stale: boolean;
}

/** A run, as listed for selection. */
export interface RunInfo {
  readonly id: string;
  /** The run and step it forked from; null for a run started from the initial configuration. */
  readonly parent: { readonly runId: string; readonly step: number } | null;
  readonly head: number;
  readonly version: string;
  readonly createdAt: number;
}

export type StartResult =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly violations: readonly Violation[] };

/** An event to probe with `enabledEvents`: a name, or a name with a sample payload. */
export type EventCandidate = string | { readonly name: string; readonly payload?: JsonValue };

export interface SimulatorOptions extends EngineOptions {
  /**
   * Builds the event descriptors of a chart's transitions, used to label taken transitions
   * and to infer internal events. Default: read from SCXML text; none for YAML (pass one built
   * from `@vertepnyk/core`'s model).
   */
  transitionIndex?: (text: string, format: Format) => TransitionIndex;
  /** Check payloads of typed charts on vertep before sending (default true). */
  checkPayloads?: boolean;
}

interface Step {
  readonly step: number;
  readonly event: StepEvent | null;
  /** What to send to reproduce the event; `undefined` payload means none. */
  readonly replay: { readonly name: string; readonly payload: JsonValue | undefined } | null;
  readonly transitions: readonly TakenTransition[];
  readonly internal: readonly InternalEvent[];
  readonly configuration: readonly string[];
  readonly context: Context;
  readonly terminated: boolean;
  readonly version: string;
  readonly replayed: boolean;
  readonly timestamp: number;
  readonly messageId: string;
}

interface Run {
  readonly id: string;
  readonly parent: RunInfo["parent"];
  readonly text: string;
  readonly format: Format;
  readonly build: BuildKind;
  readonly system: ActorSystem;
  readonly actor: ActorRef;
  readonly index: TransitionIndex;
  readonly payloads: PayloadChecker;
  readonly createdAt: number;
  readonly steps: Step[];
  /** Transitions from `onTransition`, by position (they carry the targets). */
  readonly notices: Map<number, TakenTransition[]>;
  /** Payloads this simulator sent, by position, for exact replay. */
  readonly sent: Map<number, JsonValue | undefined>;
  readonly stops: (() => void)[];
  /** Replaying into the actor: notifications do not trigger a sync. */
  replaying: boolean;
}

const NOOP_EVENT = "vertepnyk.probe.noop";

let runCounter = 0;

/** Drives charts on vertep: one simulator per open document. */
export class Simulator {
  readonly #pool: SystemPool;
  readonly #index: (text: string, format: Format) => TransitionIndex;
  readonly #checkPayloads: boolean;
  #runs: Run[] = [];
  #selected: Run | null = null;
  #view = 0;
  #stale = false;
  #disposed = false;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #listeners = new Set<(s: RunState | null) => void>();
  readonly #probes = new Map<string, Promise<ActorRef | null>>();

  constructor(options: SimulatorOptions = {}) {
    this.#pool = new SystemPool(options, true);
    this.#index = options.transitionIndex ?? defaultTransitionIndex;
    this.#checkPayloads = options.checkPayloads ?? true;
  }

  // ---- reading -------------------------------------------------------------------------

  /** The viewed step of the selected run; null before `start`. */
  get state(): RunState | null {
    const run = this.#selected;
    return run ? this.#stateOf(run, this.#view) : null;
  }

  /** Every run: the first one and its forks, in creation order. */
  get runs(): readonly RunInfo[] {
    return this.#runs.map(info);
  }

  /** The selected run. */
  get activeRun(): RunInfo | null {
    return this.#selected ? info(this.#selected) : null;
  }

  /** The event log of the selected run: every macrostep up to its head. */
  get log(): readonly LogEntry[] {
    const run = this.#selected;
    if (!run) return [];
    return run.steps.slice(1).map((s) => logEntry(run, s));
  }

  /** Whether the chart was edited since the runs started. */
  get stale(): boolean {
    return this.#stale;
  }

  /** Calls `listener` after every change of the state, runs or log. */
  onUpdate(listener: (state: RunState | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---- starting ------------------------------------------------------------------------

  /**
   * Starts a run of `text` from its initial configuration, replacing every earlier run. A chart
   * vertep refuses does not start: the result lists its violations.
   */
  start(text: string, format: Format): Promise<StartResult> {
    return this.#enqueue(async () => {
      const run = await this.#createRun(text, format, [], null);
      if (!isRun(run)) return { ok: false, violations: run };
      this.#replaceRuns(run);
      this.#emit();
      return { ok: true, state: this.#stateOf(run, 0) };
    });
  }

  /** Back to the initial configuration of the selected run's chart; earlier runs are dropped. */
  reset(): Promise<RunState> {
    return this.#enqueue(async () => {
      const cur = this.#requireRun();
      const run = await this.#createRun(cur.text, cur.format, [], null);
      if (!isRun(run)) throw new SimulationError("ChartInvalid", "the chart no longer starts", run);
      this.#replaceRuns(run);
      this.#emit();
      return this.#stateOf(run, 0);
    });
  }

  /** Marks the runs stale: the chart was edited. `replay` restarts on the edited text. */
  markStale(): void {
    if (this.#stale) return;
    this.#stale = true;
    this.#emit();
  }

  /**
   * Re-sends the selected run's events (those the user sent, not timer deliveries) to a fresh
   * actor of `text`, from its initial configuration. On success the new run replaces every
   * earlier run and the simulation is no longer stale; when vertep refuses the edited chart the
   * runs stay as they were.
   */
  replay(text: string, format: Format): Promise<StartResult & { readonly replayed?: number }> {
    return this.#enqueue(async () => {
      const cur = this.#requireRun();
      const events = cur.steps
        .slice(1)
        .filter((s) => s.event?.origin === "external")
        .map((s) => s.replay)
        .filter((r): r is NonNullable<Step["replay"]> => r !== null);
      const run = await this.#createRun(text, format, events, null);
      if (!isRun(run)) return { ok: false, violations: run };
      this.#replaceRuns(run);
      this.#view = lastStep(run);
      this.#emit();
      return { ok: true, state: this.#stateOf(run, this.#view), replayed: events.length };
    });
  }

  // ---- sending -------------------------------------------------------------------------

  /**
   * Sends event `name` with `payload` (any JSON; omitted: no payload). While an earlier step is
   * viewed, this forks a new run from that step and selects it. Throws `SimulationError`:
   * `RunDone` after a top-level final state, `PayloadType` (a `PayloadTypeError`) when vertep
   * refuses the payload for the event's declared type; nothing is sent then.
   */
  send(name: string, payload?: JsonValue): Promise<RunState> {
    return this.#enqueue(async () => {
      let run = this.#requireRun();
      const viewed = this.#step(run, this.#view);
      if (viewed.terminated) {
        throw new SimulationError("RunDone", "the run reached a top-level final state: reset or travel back to send events");
      }
      if (this.#checkPayloads && run.payloads.typed) {
        const c = await run.payloads.check(run.system, name, payload);
        if (!c.ok) throw new PayloadTypeError(name, payload, c.message);
      }
      if (this.#view < lastStep(run)) {
        const prefix = run.steps
          .slice(1, this.#view + 1)
          .map((s) => s.replay)
          .filter((r): r is NonNullable<Step["replay"]> => r !== null);
        const fork = await this.#createRun(run.text, run.format, prefix, { runId: run.id, step: this.#view });
        if (!isRun(fork)) throw new SimulationError("ChartInvalid", "the chart no longer starts", fork);
        this.#runs.push(fork);
        this.#selected = fork;
        run = fork;
      }
      await this.#sendTo(run, name, payload, false);
      this.#view = lastStep(run);
      this.#emit();
      return this.#stateOf(run, this.#view);
    });
  }

  /**
   * The candidates vertep would accept at the viewed step (`can`: they enable a transition or
   * an active state defers them). Guards that read the payload see the candidate's sample
   * payload, or none. Nothing is sent to the run.
   */
  enabledEvents(candidates: readonly EventCandidate[]): Promise<string[]> {
    return this.#enqueue(async () => {
      const run = this.#requireRun();
      const viewed = this.#step(run, this.#view);
      if (viewed.terminated) return [];
      // vertep answers `can` only for an actor with a journal entry, and for its latest one
      const actor = this.#view > 0 && this.#view === lastStep(run) ? run.actor : await this.#probe(run, this.#view);
      if (!actor) return [];
      const names = candidates.map((c) => (typeof c === "string" ? { name: c, payload: undefined } : c));
      const ok = await Promise.all(names.map((c) => actor.can(event(c.name, c.payload))));
      return names.filter((_, i) => ok[i]).map((c) => c.name);
    });
  }

  // ---- time travel ---------------------------------------------------------------------

  /** Shows `step` of the selected run (clamped to 0..head), read with vertep's `asOf`. */
  goto(step: number): Promise<RunState> {
    return this.#goto(() => step);
  }

  /** One step back. */
  back(): Promise<RunState> {
    return this.#goto((view) => view - 1);
  }

  /** One step forward. */
  forward(): Promise<RunState> {
    return this.#goto((view) => view + 1);
  }

  #goto(to: (view: number) => number): Promise<RunState> {
    return this.#enqueue(async () => {
      const run = this.#requireRun();
      const target = Math.max(0, Math.min(lastStep(run), Math.trunc(to(this.#view))));
      const snap = await run.actor.asOf({ position: target });
      const cached = this.#step(run, target);
      // the journal is the source of truth: refresh the cached step from vertep's replay
      run.steps[target] = {
        ...cached,
        configuration: snap.configuration,
        context: normalizeContext(snap.context),
        terminated: snap.terminated,
      };
      this.#view = target;
      this.#emit();
      return this.#stateOf(run, target);
    });
  }

  /** Selects run `id` and shows its latest step. */
  selectRun(id: string): Promise<RunState> {
    return this.#enqueue(async () => {
      const run = this.#runs.find((r) => r.id === id);
      if (!run) throw new SimulationError("NotFound", `no run ${id}`);
      this.#selected = run;
      this.#view = lastStep(run);
      this.#emit();
      return this.#stateOf(run, this.#view);
    });
  }

  /** Stops vertep's workers; every later call rejects with `Disposed`. */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const r of this.#runs) for (const stop of r.stops) stop();
    this.#runs = [];
    this.#selected = null;
    this.#listeners.clear();
    await this.#queue.catch(() => undefined);
    await this.#pool.dispose();
  }

  // ---- internals -----------------------------------------------------------------------

  #enqueue<T>(f: () => Promise<T>): Promise<T> {
    if (this.#disposed) return Promise.reject(new SimulationError("Disposed", "the simulator is disposed"));
    const p = this.#queue.then(() => {
      if (this.#disposed) throw new SimulationError("Disposed", "the simulator is disposed");
      return f();
    });
    this.#queue = p.catch(() => undefined);
    return p;
  }

  #requireRun(): Run {
    if (!this.#selected) throw new SimulationError("NotStarted", "no simulation: start one first");
    return this.#selected;
  }

  #step(run: Run, step: number): Step {
    const s = run.steps[step];
    if (!s) throw new SimulationError("NotFound", `run ${run.id} has no step ${step}`);
    return s;
  }

  #replaceRuns(run: Run): void {
    for (const r of this.#runs) for (const stop of r.stops) stop();
    this.#runs = [run];
    this.#selected = run;
    this.#view = 0;
    this.#stale = false;
    this.#probes.clear();
  }

  #emit(): void {
    const s = this.state;
    for (const l of this.#listeners) {
      try {
        l(s);
      } catch (e) {
        console.error("vertepnyk sim: an update listener failed", e);
      }
    }
  }

  /** Registers and spawns a run, replaying `events`; the violations when vertep refuses the chart. */
  async #createRun(
    text: string,
    format: Format,
    events: readonly NonNullable<Step["replay"]>[],
    parent: Run["parent"],
  ): Promise<Run | readonly Violation[]> {
    const build = buildFor(declaredDatamodel(text, format));
    const system = await this.#pool.get(build);
    let actor: ActorRef;
    try {
      await system.register(text, { format });
      actor = await system.spawn(text, { format });
    } catch (e) {
      if (e instanceof VertepError && e.code === "ChartInvalid") {
        const raw = e.violations.length > 0 ? e.violations : [{ message: e.message, line: 0, column: 0 }];
        return raw.map(normalizeViolation);
      }
      throw e;
    }
    const run: Run = {
      id: `run-${++runCounter}`,
      parent,
      text,
      format,
      build,
      system,
      actor,
      index: this.#index(text, format),
      payloads: new PayloadChecker(text, format),
      createdAt: Date.now(),
      steps: [],
      notices: new Map(),
      sent: new Map(),
      stops: [],
      replaying: true,
    };
    // subscribed before the first send: the worker handles calls in order
    run.stops.push(
      actor.onTransition((n) => {
        run.notices.set(
          n.position,
          n.transitions.map((t) => taken(run, t.iri, t.targets)),
        );
        if (!run.replaying && n.position > lastStep(run)) this.#follow(run);
      }),
    );
    const initial = await actor.getSnapshot();
    run.steps.push({
      step: 0,
      event: null,
      replay: null,
      transitions: [],
      internal: [],
      configuration: initial.configuration,
      context: normalizeContext(initial.context),
      terminated: initial.terminated,
      version: initial.version,
      replayed: false,
      timestamp: Date.now(),
      messageId: "",
    });
    for (const e of events) await this.#sendTo(run, e.name, e.payload, true);
    run.replaying = false;
    return run;
  }

  /** Sends to `run`'s actor and appends the resulting journal entries as steps. */
  async #sendTo(run: Run, name: string, payload: JsonValue | undefined, replayed: boolean): Promise<void> {
    const before = lastStep(run);
    await run.actor.send(event(name, payload));
    run.sent.set(before + 1, payload);
    await this.#sync(run, replayed);
  }

  /** Appends the journal entries after the run's last step. */
  async #sync(run: Run, replayed: boolean): Promise<number> {
    const from = lastStep(run) + 1;
    const entries = await run.actor.journal({ from });
    let added = 0;
    for (const e of entries) {
      if (e.position !== lastStep(run) + 1) continue;
      const snap = await run.actor.asOf({ position: e.position });
      run.steps.push(this.#stepOf(run, e, snap, replayed));
      added++;
    }
    return added;
  }

  #stepOf(run: Run, e: JournalEntry, snap: Snapshot, replayed: boolean): Step {
    const transitions = (run.notices.get(e.position) ?? (e.transitions ?? []).map((iri) => taken(run, iri, []))).map((t) => t);
    const name = e.event?.name ?? e.kind;
    const data = (e.event?.data ?? null) as JsonValue | null;
    const origin: StepEvent["origin"] = e.timer ? "timer" : "external";
    const payload = run.sent.has(e.position) ? run.sent.get(e.position) : data === null ? undefined : data;
    return {
      step: e.position,
      event: { name, data, origin },
      replay: e.kind === "input" ? { name, payload } : null,
      transitions,
      internal: inferInternalEvents(name, transitions),
      configuration: snap.configuration,
      context: normalizeContext(snap.context),
      terminated: snap.terminated,
      version: snap.version,
      replayed,
      timestamp: e.timestamp,
      messageId: e.messageId,
    };
  }

  /** A journal entry vertep appended on its own (a timer fired): append it, follow if live. */
  #follow(run: Run): void {
    void this.#enqueue(async () => {
      if (!this.#runs.includes(run)) return;
      const wasLive = this.#selected === run && this.#view === lastStep(run);
      const added = await this.#sync(run, false);
      if (added === 0) return;
      if (wasLive) this.#view = lastStep(run);
      this.#emit();
    }).catch(() => undefined);
  }

  /**
   * An actor of `run`'s chart at `step`, for `can`: the run's events up to `step` sent to a
   * fresh actor, and at step 0 one event no transition names (vertep answers `can` only after
   * a journal entry). Null when that event took a transition (a `*` descriptor).
   */
  #probe(run: Run, step: number): Promise<ActorRef | null> {
    const key = `${run.id}@${step}`;
    let p = this.#probes.get(key);
    if (!p) {
      p = (async () => {
        const actor = await run.system.spawn(run.text, { format: run.format });
        for (const s of run.steps.slice(1, step + 1)) {
          if (s.replay) await actor.send(event(s.replay.name, s.replay.payload));
        }
        if (step === 0) {
          await actor.send(event(NOOP_EVENT, undefined));
          const [entry] = await actor.journal({ from: 1 });
          if (!entry || (entry.transitions?.length ?? 0) > 0) return null;
        }
        return actor;
      })();
      this.#probes.set(key, p);
      p.catch(() => this.#probes.delete(key));
    }
    return p;
  }

  #stateOf(run: Run, step: number): RunState {
    const s = this.#step(run, step);
    const prev = step > 0 ? run.steps[step - 1] : undefined;
    return {
      runId: run.id,
      step,
      head: lastStep(run),
      live: step === lastStep(run),
      configuration: s.configuration,
      context: s.context,
      changed: changedKeys(prev?.context, s.context),
      transitions: s.transitions,
      internal: s.internal,
      event: s.event,
      done: s.terminated,
      doneData: undefined,
      finalStates: s.terminated ? s.transitions.flatMap((t) => t.targets) : [],
      version: s.version,
      stale: this.#stale,
    };
  }
}

function isRun(r: Run | readonly Violation[]): r is Run {
  return !Array.isArray(r);
}

function lastStep(run: Run): number {
  return run.steps.length - 1;
}

function info(r: Run): RunInfo {
  return {
    id: r.id,
    parent: r.parent,
    head: lastStep(r),
    version: r.steps[0]?.version ?? "",
    createdAt: r.createdAt,
  };
}

function logEntry(run: Run, s: Step): LogEntry {
  const prev = run.steps[s.step - 1];
  return {
    step: s.step,
    event: s.event ?? { name: "", data: null, origin: "external" },
    internal: s.internal,
    transitions: s.transitions,
    configuration: s.configuration,
    context: s.context,
    changed: changedKeys(prev?.context, s.context),
    terminated: s.terminated,
    replayed: s.replayed,
    timestamp: s.timestamp,
    messageId: s.messageId,
  };
}

/** The wire event: the payload goes in `data` whole, so a payload field named `type` survives. */
function event(name: string, payload: JsonValue | undefined): { type: string; data?: JsonValue } {
  return payload === undefined ? { type: name } : { type: name, data: payload };
}

function taken(run: Run, iri: string, targets: readonly string[]): TakenTransition {
  const { source, index } = decodeTransitionIri(iri);
  const id = `${source}#${index ?? "?"}`;
  const events = index === null ? undefined : run.index(id);
  return { id, source, index, targets, iri, ...(events ? { events } : {}) };
}
