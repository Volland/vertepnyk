/**
 * The designer controller: wires one host's buffer to the document model, live validation on
 * vertep and the simulator. Framework-free; the UI subscribes to `state` changes.
 */
import { ChartDocument, type ChartModel, type DocumentChange } from "@vertepnyk/core";
import type { HostBridge, HostDiagnostic, Unsubscribe } from "@vertepnyk/host-bridge";
import {
  Simulator,
  Validator,
  liveValidation,
  type EngineOptions,
  type JsonValue,
  type LiveValidation,
  type RunState,
  type StartResult,
  type TransitionIndex,
  type Violation,
} from "@vertepnyk/sim";

export interface DesignerOptions {
  /** Options for vertep's worker (asset URLs in VS Code webviews, injected systems in tests). */
  engine?: EngineOptions;
  /** Debounce of live validation, ms (default 250). */
  validationDelayMs?: number;
  /** Replace the validator/simulator (tests). */
  validator?: Validator;
  simulator?: Simulator;
}

export type ValidationState =
  | { readonly status: "pending" }
  | { readonly status: "valid"; readonly version: string }
  | { readonly status: "invalid"; readonly violations: readonly Violation[] }
  | { readonly status: "unparseable" };

/** Everything the UI renders from, replaced as a whole on every change. */
export interface DesignerState {
  readonly model: ChartModel | null;
  readonly parseError: { readonly message: string; readonly line: number; readonly column: number } | null;
  readonly validation: ValidationState;
  readonly diagnostics: readonly HostDiagnostic[];
  readonly run: RunState | null;
  /** The run's chart no longer matches the text. */
  readonly runStale: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirtyGeneration: number;
}

/** A transition index for the simulator, built from the document's model (SCXML and YAML). */
export function transitionIndexFor(model: ChartModel | null): TransitionIndex {
  return (id) => model?.transitions.get(id)?.events;
}

// @tg: implements:: [[openspec:host-bridge#Hosts own the buffer]]
// @tg: implements:: [[openspec:host-bridge#Same behaviour in every host]] {note: "validation and simulation run in this one controller for every host"}
// @tg: implements:: [[openspec:chart-validation#Continuous validation]] {confidence: partial, note: "wired here; the validator is in sim"}
export class DesignerController {
  readonly host: HostBridge;
  readonly doc: ChartDocument;
  readonly validator: Validator;
  readonly simulator: Simulator;
  #state: DesignerState;
  #generation = 0;
  #listeners = new Set<(s: DesignerState) => void>();
  #live: LiveValidation;
  #subs: Unsubscribe[] = [];
  #disposed = false;
  #simUnsub: () => void;
  #run: RunState | null = null;
  #stale = false;

  constructor(host: HostBridge, options: DesignerOptions = {}) {
    this.host = host;
    this.doc = ChartDocument.open(host.getText(), host.format);
    this.validator = options.validator ?? new Validator(options.engine);
    this.simulator =
      options.simulator ??
      new Simulator({
        ...options.engine,
        transitionIndex: (text, format) => transitionIndexFor(ChartDocument.open(text, format).model),
      });
    this.#live = liveValidation(
      this.validator,
      {
        onResult: (r) => {
          if (this.#disposed) return;
          this.#setValidation(
            r.status === "valid"
              ? { status: "valid", version: r.version }
              : { status: "invalid", violations: r.violations },
          );
        },
        onError: () => {
          // a failure of vertep itself is not a chart diagnostic; leave the last result
        },
      },
      options.validationDelayMs ?? 250,
    );
    this.#state = this.#snapshot({ status: "pending" });

    this.#subs.push(
      host.onDidChangeText((text) => {
        if (text !== this.doc.text) this.doc.setText(text, "external");
      }),
      this.doc.onChange((c) => this.#onDocChange(c)),
    );
    this.#simUnsub = this.simulator.onUpdate((s) => {
      this.#run = s;
      this.#publish();
    });
    this.#revalidate();
  }

  get state(): DesignerState {
    return this.#state;
  }

  subscribe(listener: (s: DesignerState) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Validates now (used before starting a run and by tests). */
  flushValidation(): void {
    this.#live.flush();
  }

  undo(): void {
    if (this.host.capabilities.nativeUndo && this.host.undo) this.host.undo();
    else this.doc.undo();
  }

  redo(): void {
    if (this.host.capabilities.nativeUndo && this.host.redo) this.host.redo();
    else this.doc.redo();
  }

  // ---- simulation ----------------------------------------------------------------------

  // @tg: implements:: [[openspec:chart-simulation#Start and reset]] {confidence: partial, note: "the invalid-chart refusal; the run is in sim"}
  async startSimulation(): Promise<StartResult> {
    const r = await this.simulator.start(this.doc.text, this.doc.format);
    this.#stale = false;
    if (!r.ok) this.#setValidation({ status: "invalid", violations: r.violations });
    this.#publish();
    return r;
  }

  async resetSimulation(): Promise<void> {
    await this.simulator.reset();
    this.#stale = false;
    this.#publish();
  }

  /** Re-sends the run's external events to the edited chart. */
  async replaySimulation(): Promise<StartResult> {
    const r = await this.simulator.replay(this.doc.text, this.doc.format);
    this.#stale = false;
    this.#publish();
    return r;
  }

  async send(name: string, payload?: JsonValue): Promise<RunState> {
    return this.simulator.send(name, payload);
  }

  // ---- internals -----------------------------------------------------------------------

  #onDocChange(c: DocumentChange): void {
    if (c.origin === "edit" || c.origin === "undo" || c.origin === "redo") {
      if (c.patches.length > 0) {
        const before = this.doc.text;
        void this.host.applyPatches(c.patches, c.origin).then((ok) => {
          // the host refused (its buffer changed meanwhile): trust the host's text
          if (!ok && !this.#disposed) {
            const hostText = this.host.getText();
            if (hostText !== before) this.doc.setText(hostText, "external");
          }
        });
      }
    }
    if (this.simulator.state) this.#stale = true;
    this.#revalidate();
    this.#generation++;
    this.#publish();
  }

  #revalidate(): void {
    if (this.doc.error) {
      this.#live.cancel();
      this.#setValidation({ status: "unparseable" });
      return;
    }
    this.#setValidation({ status: "pending" }, false);
    this.#live.update(this.doc.text, this.doc.format);
  }

  #setValidation(v: ValidationState, publish = true): void {
    this.#state = this.#snapshot(v);
    if (publish) {
      this.host.publishDiagnostics(this.#state.diagnostics);
      this.#emit();
    }
  }

  #publish(): void {
    this.#state = this.#snapshot(this.#state.validation);
    this.#emit();
  }

  #emit(): void {
    for (const l of this.#listeners) l(this.#state);
  }

  #snapshot(validation: ValidationState): DesignerState {
    const err = this.doc.error;
    const diagnostics: HostDiagnostic[] = [];
    if (err) {
      diagnostics.push({
        message: err.message,
        severity: "error",
        line: err.line,
        column: err.column,
        source: "parse",
      });
    }
    if (validation.status === "invalid") {
      for (const v of validation.violations) {
        diagnostics.push({
          message: v.message,
          severity: "error",
          ...(v.line !== undefined && v.line > 0 ? { line: v.line } : {}),
          ...(v.column !== undefined && v.line !== undefined && v.line > 0 ? { column: v.column } : {}),
          source: "vertep",
          ...(v.rule ? { code: v.rule } : {}),
        });
      }
    }
    return {
      model: this.doc.model,
      parseError: err ? { message: err.message, line: err.line, column: err.column } : null,
      validation,
      diagnostics,
      run: this.#run,
      runStale: this.#stale,
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      dirtyGeneration: this.#generation,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#live.cancel();
    for (const u of this.#subs) u();
    this.#simUnsub();
    this.#listeners.clear();
    this.simulator.dispose();
    this.validator.dispose();
  }
}
