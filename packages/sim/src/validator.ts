/**
 * Continuous validation by vertep: the chart text is registered in a long-lived scratch
 * `ActorSystem` (memory storage, no journal), and vertep's `ChartInvalid` violations or its
 * version IRI are the result. The designer adds and suppresses nothing.
 *
 * Every `validate` call takes a number from a monotonic sequence; when a newer call has started
 * by the time an older one finishes (or before it reaches the worker), the older one resolves
 * as `{status: "stale"}`, so callers only ever show the diagnostics of the latest text.
 */
// @tg: implements:: [[openspec:chart-validation#Validation runs on vertep]]
// @tg: implements:: [[openspec:chart-validation#Continuous validation]]
// @tg: implements:: [[openspec:chart-validation#Content hash shown]]
// @tg: implements:: [[openspec:chart-validation#Datamodel-aware checks]]

import { VertepError } from "@vertep/web";
import { type BuildKind, type EngineOptions, type Format, SystemPool, buildFor, declaredDatamodel } from "./engine.js";
import { type Violation, normalizeViolation } from "./violations.js";

/** What validating one text found. */
export type ValidationResult =
  | {
      readonly status: "valid";
      readonly seq: number;
      /** The chart's version IRI (content hash) as vertep computes it. */
      readonly version: string;
      /** The datamodel the chart declares (`null`: vertep's default). */
      readonly datamodel: string | null;
      /** The build that validated it. */
      readonly build: BuildKind;
    }
  | {
      readonly status: "invalid";
      readonly seq: number;
      /** vertep's violations, one per violation it reported. */
      readonly violations: readonly Violation[];
      readonly datamodel: string | null;
      readonly build: BuildKind;
    }
  | {
      /** A newer `validate` call superseded this one; show nothing for it. */
      readonly status: "stale";
      readonly seq: number;
    };

export interface ValidatorOptions extends EngineOptions {
  /**
   * Restart a scratch system after this many registrations: every distinct text stays
   * registered in its memory store, so a long editing session would otherwise only grow.
   * 500 by default; 0 never restarts.
   */
  recycleAfter?: number;
}

/** Validates chart texts on vertep. One instance per open document. */
export class Validator {
  readonly #pool: SystemPool;
  readonly #recycleAfter: number;
  readonly #registrations = new Map<BuildKind, number>();
  #seq = 0;
  #disposed = false;

  constructor(options: ValidatorOptions = {}) {
    this.#pool = new SystemPool(options, false);
    this.#recycleAfter = options.recycleAfter ?? 500;
  }

  /** The sequence number of the latest `validate` call. */
  get latest(): number {
    return this.#seq;
  }

  /**
   * Validates `text`. `datamodel` overrides the datamodel read from the text (its
   * `datamodel` attribute or key), which picks the vertep build: ECMAScript through
   * `@vertep/dm-ecma`, everything else on the default build.
   *
   * Rejects only when vertep itself fails (its worker cannot start or died); a chart's
   * problems resolve as `{status: "invalid"}`.
   */
  async validate(text: string, format: Format, options: { datamodel?: string | null } = {}): Promise<ValidationResult> {
    if (this.#disposed) throw new Error("the validator is disposed");
    const seq = ++this.#seq;
    const datamodel = options.datamodel !== undefined ? options.datamodel : declaredDatamodel(text, format);
    const build = buildFor(datamodel);
    const system = await this.#pool.get(build);
    if (seq !== this.#seq) return { status: "stale", seq };
    let result: ValidationResult;
    try {
      const r = await system.register(text, { format });
      result = { status: "valid", seq, version: r.version, datamodel, build };
    } catch (e) {
      if (e instanceof VertepError && e.code === "ChartInvalid") {
        const raw = e.violations.length > 0 ? e.violations : [{ message: e.message, line: 0, column: 0 }];
        result = { status: "invalid", seq, violations: raw.map(normalizeViolation), datamodel, build };
      } else {
        if (e instanceof VertepError && e.code === "WorkerTerminated") await this.#pool.recycle(build);
        if (seq !== this.#seq) return { status: "stale", seq };
        throw e;
      }
    }
    await this.#count(build);
    return seq === this.#seq ? result : { status: "stale", seq };
  }

  async #count(build: BuildKind): Promise<void> {
    const n = (this.#registrations.get(build) ?? 0) + 1;
    this.#registrations.set(build, n);
    if (this.#recycleAfter > 0 && n >= this.#recycleAfter) {
      this.#registrations.set(build, 0);
      await this.#pool.recycle(build);
    }
  }

  /** Stops vertep's workers. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.#pool.dispose();
  }
}

/** A debounced function with control over its pending call. */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drops the pending call. */
  cancel(): void;
  /** Runs the pending call now, if any. */
  flush(): void;
  /** Whether a call is pending. */
  readonly pending: boolean;
}

/** Calls `f` with the latest arguments once `ms` passed without another call. */
export function debounce<A extends unknown[]>(f: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  const run = () => {
    timer = null;
    const args = last;
    last = null;
    if (args) f(...args);
  };
  const d = ((...args: A) => {
    last = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;
  d.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    last = null;
  };
  d.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      run();
    }
  };
  Object.defineProperty(d, "pending", { get: () => timer !== null });
  return d;
}

/** A validator driven by edits: debounced, reporting only results for the latest text. */
export interface LiveValidation {
  /** The text changed: validate it after the debounce delay. */
  update(text: string, format: Format, options?: { datamodel?: string | null }): void;
  /** Validates the pending text now. */
  flush(): void;
  /** Drops the pending validation. */
  cancel(): void;
}

/**
 * Wires a `Validator` to edits: `update` after every edit, `onResult` gets the diagnostics of
 * the latest text only (stale results are dropped), `onError` when vertep itself fails.
 */
export function liveValidation(
  validator: Validator,
  handlers: { onResult: (r: Exclude<ValidationResult, { status: "stale" }>) => void; onError?: (e: unknown) => void },
  delayMs = 250,
): LiveValidation {
  // bumped on every edit: a result for an older text is dropped even while the newer text
  // still waits in the debounce window
  let edit = 0;
  const run = debounce((text: string, format: Format, options: { datamodel?: string | null }, at: number) => {
    validator.validate(text, format, options).then(
      (r) => {
        if (r.status !== "stale" && at === edit) handlers.onResult(r);
      },
      (e) => {
        if (at === edit) handlers.onError?.(e);
      },
    );
  }, delayMs);
  return {
    update: (text, format, options = {}) => run(text, format, options, ++edit),
    flush: () => run.flush(),
    cancel: () => {
      edit++;
      run.cancel();
    },
  };
}
