/**
 * The Simulation tab: run controls, configuration, enabled events, send form, context, event
 * log and time travel, all read from the controller's simulator.
 */
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import { PayloadTypeError, SimulationError, type JsonValue, type LogEntry, type RunInfo } from "@vertepnyk/sim";
import type { DesignerController, DesignerState } from "./controller.js";

export interface SimulationPanelProps {
  controller: DesignerController;
  state: () => DesignerState;
  /** Reports a refusal to start (the violations are in `state.validation`). */
  onStartRefused?: () => void;
}

const show = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? "undefined";
  } catch {
    return String(v);
  }
};

// @tg: implements:: [[openspec:chart-simulation#Start and reset]]
// @tg: implements:: [[openspec:chart-simulation#Enabled events are offered]]
// @tg: implements:: [[openspec:chart-simulation#Send events with payload]]
// @tg: implements:: [[openspec:chart-simulation#Context is shown]]
// @tg: implements:: [[openspec:chart-simulation#Event log]]
// @tg: implements:: [[openspec:chart-simulation#Time travel]]
// @tg: implements:: [[openspec:chart-simulation#Live edits during simulation]]
// @tg: implements:: [[openspec:chart-simulation#Final state ends the run]]
export function SimulationPanel(props: SimulationPanelProps): JSX.Element {
  const ctl = props.controller;
  const sim = ctl.simulator;
  const run = () => props.state().run;
  const [enabled, setEnabled] = createSignal<readonly string[]>([]);
  const [name, setName] = createSignal("");
  const [payload, setPayload] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  let seq = 0;
  createEffect(
    on(
      () => [run(), props.state().model] as const,
      ([r, model]) => {
        const mine = ++seq;
        if (!r || !model) {
          setEnabled([]);
          return;
        }
        sim
          .enabledEvents(model.events)
          .then((e) => mine === seq && setEnabled(e))
          .catch(() => mine === seq && setEnabled([]));
      },
    ),
  );

  // the log and the run list live on the simulator; they change whenever `run` does
  const log = createMemo<readonly LogEntry[]>(() => (run() ? sim.log : []));
  const runs = createMemo<readonly RunInfo[]>(() => (run() ? sim.runs : []));
  const runLabel = (r: RunInfo, i: number): string =>
    r.parent ? `fork ${i + 1} (from step ${r.parent.step})` : `run ${i + 1}`;

  const guarded = async (f: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = (): Promise<void> =>
    guarded(async () => {
      setError(null);
      const r = await ctl.startSimulation();
      if (!r.ok) props.onStartRefused?.();
    });

  const send = (eventName: string): Promise<void> =>
    guarded(async () => {
      setError(null);
      const n = eventName.trim();
      if (!n) {
        setError("Enter an event name.");
        return;
      }
      let data: JsonValue | undefined;
      const text = payload().trim();
      if (text) {
        try {
          data = JSON.parse(text) as JsonValue;
        } catch (e) {
          setError(`Payload is not valid JSON: ${(e as Error).message}`);
          return;
        }
      }
      try {
        await ctl.send(n, data);
      } catch (e) {
        if (e instanceof PayloadTypeError) setError(`Payload type error for ${e.event}: ${e.message}`);
        else if (e instanceof SimulationError) setError(e.message);
        else throw e;
      }
    });

  const changed = createMemo(() => new Set(run()?.changed ?? []));
  const contextRows = createMemo(() => Object.entries(run()?.context ?? {}));
  const forking = () => {
    const r = run();
    return r !== null && !r.live && !r.done;
  };

  return (
    <div class="vd-panel vd-sim" data-testid="sim-panel">
      <div class="vd-row">
        <button type="button" class="vd-btn vd-primary" data-testid="sim-start" disabled={busy()} onClick={() => void start()}>
          {run() ? "Restart" : "Start"}
        </button>
        <button type="button" class="vd-btn" data-testid="sim-reset" disabled={!run() || busy()} onClick={() => void guarded(() => ctl.resetSimulation())}>
          Reset
        </button>
      </div>

      <Show when={props.state().runStale && run()}>
        <div class="vd-banner vd-warn" role="status" data-testid="stale-banner">
          <span>The chart changed since this run started.</span>
          <button type="button" class="vd-btn" data-testid="sim-replay" onClick={() => void guarded(() => ctl.replaySimulation())}>
            Replay
          </button>
        </div>
      </Show>

      <Show when={error()}>
        <div class="vd-banner vd-err" role="alert" data-testid="sim-error">
          {error()}
        </div>
      </Show>

      <Show
        when={run()}
        fallback={<p class="vd-hint">Start a simulation to run this chart on vertep. A chart with errors does not start; see Problems.</p>}
      >
        {(r) => (
          <>
            <Show when={r().done}>
              <div class="vd-banner vd-ok" role="status" data-testid="run-done">
                Run is done. Final state{r().finalStates.length === 1 ? "" : "s"}:{" "}
                <strong>{r().finalStates.join(", ") || "none"}</strong>
                <Show when={r().doneData !== undefined}> with {show(r().doneData)}</Show>. Reset or step back to continue.
              </div>
            </Show>

            <section aria-label="Time travel" class="vd-sect">
              <h3>
                Step {r().step} of {r().head}
                <Show when={runs().length > 1}>
                  <select
                    class="vd-select"
                    data-testid="run-picker"
                    aria-label="Run"
                    onChange={(e) => void guarded(() => sim.selectRun(e.currentTarget.value))}
                  >
                    <For each={runs()}>
                      {(ri, i) => (
                        <option value={ri.id} selected={ri.id === r().runId}>
                          {runLabel(ri, i())}
                        </option>
                      )}
                    </For>
                  </select>
                </Show>
              </h3>
              <div class="vd-row">
                <button type="button" class="vd-btn" data-testid="step-back" aria-label="Step back" disabled={r().step <= 0 || busy()} onClick={() => void guarded(() => sim.back())}>
                  Back
                </button>
                <input
                  type="range"
                  class="vd-slider"
                  data-testid="time-slider"
                  aria-label="Step"
                  min="0"
                  max={r().head}
                  value={r().step}
                  onChange={(e) => void guarded(() => sim.goto(Number(e.currentTarget.value)))}
                />
                <button type="button" class="vd-btn" data-testid="step-forward" aria-label="Step forward" disabled={r().step >= r().head || busy()} onClick={() => void guarded(() => sim.forward())}>
                  Forward
                </button>
              </div>
              <Show when={forking()}>
                <p class="vd-hint" data-testid="fork-hint">
                  Viewing step {r().step}. Sending an event forks a new run from here; the original stays available.
                </p>
              </Show>
            </section>

            <section aria-label="Configuration" class="vd-sect">
              <h3>Configuration</h3>
              <div class="vd-chips" data-testid="sim-config">
                <For each={r().configuration.length > 0 ? r().configuration : r().finalStates} fallback={<span class="vd-muted">empty</span>}>
                  {(s) => (
                    <span class="vd-chip vd-chip-active" data-state={s}>
                      {s}
                    </span>
                  )}
                </For>
              </div>
            </section>

            <section aria-label="Events" class="vd-sect">
              <h3>Events</h3>
              <div class="vd-chips" data-testid="enabled-events">
                <For each={enabled()} fallback={<span class="vd-muted">none enabled</span>}>
                  {(ev) => (
                    <button type="button" class="vd-chip vd-chip-btn" data-testid="enabled-event" data-event={ev} disabled={r().done && r().live} onClick={() => void send(ev)} title="Send with the payload below">
                      {ev}
                    </button>
                  )}
                </For>
              </div>
              <form
                class="vd-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(name());
                }}
              >
                <input class="vd-input vd-mono" data-testid="event-name" aria-label="Event name" placeholder="event name" value={name()} onInput={(e) => setName(e.currentTarget.value)} list="vd-events" />
                <datalist id="vd-events">
                  <For each={props.state().model?.events ?? []}>{(ev) => <option value={ev} />}</For>
                </datalist>
                <textarea class="vd-input vd-mono" data-testid="event-payload" aria-label="Payload (JSON)" placeholder='payload, e.g. {"amount": 150}' rows="2" value={payload()} onInput={(e) => setPayload(e.currentTarget.value)} />
                <button type="submit" class="vd-btn vd-primary" data-testid="send" disabled={busy() || (r().done && r().live)}>
                  Send
                </button>
              </form>
            </section>

            <section aria-label="Context" class="vd-sect">
              <h3>Context</h3>
              <div class="vd-table" role="table" data-testid="context-table">
                <For each={contextRows()} fallback={<div class="vd-muted">no data</div>}>
                  {([k, v]) => (
                    <div role="row" class="vd-ctxrow" data-testid="context-row" data-key={k} data-changed={changed().has(k) ? "true" : "false"} classList={{ "vd-changed": changed().has(k) }}>
                      <span role="rowheader" class="vd-ctxkey">{k}</span>
                      <span role="cell" class="vd-mono vd-ctxval">{show(v)}</span>
                      <span role="cell" class="vd-flag">{changed().has(k) ? "changed" : ""}</span>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section aria-label="Event log" class="vd-sect">
              <h3>Log</h3>
              <ol class="vd-log" data-testid="event-log">
                <For each={log()} fallback={<li class="vd-muted">no events yet</li>}>
                  {(e) => (
                    <li classList={{ "vd-current": e.step === r().step }} data-testid="log-entry" data-step={e.step}>
                      <button type="button" class="vd-logbtn" onClick={() => void guarded(() => sim.goto(e.step))} title="Travel to this step">
                        <span class="vd-step">{e.step}</span>
                        <span class="vd-mono vd-ev">
                          {e.event.name}
                          <Show when={e.event.data !== null}> {show(e.event.data)}</Show>
                        </span>
                      </button>
                      <div class="vd-logdetail">
                        <Show when={e.transitions.length > 0} fallback={<span class="vd-muted">no transition</span>}>
                          <span data-testid="log-transitions">{e.transitions.map((t) => `${t.source} → ${t.targets.join(", ") || "(internal)"}`).join("; ")}</span>
                        </Show>
                        <For each={e.internal}>
                          {(i) => (
                            <div data-testid="log-internal" class="vd-internal">
                              internal event <span class="vd-mono">{i.name}</span>
                            </div>
                          )}
                        </For>
                        <div class="vd-muted">{e.terminated ? "done" : e.configuration.join(", ")}</div>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}
