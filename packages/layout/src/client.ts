/**
 * The UI-thread side of layout: sends requests to the layout worker, one at a time. A newer
 * request supersedes an older one: the older promise rejects with `LayoutCancelledError` and,
 * when it is running in a worker, the worker is terminated and replaced on the next request.
 */
import { computeLayout, layoutTexts, LayoutAbortedError } from "./layout.js";
import type { LayoutModel, LayoutResult } from "./layout.js";
import { toWireModel } from "./protocol.js";
import type { LayoutRequest, LayoutResponse } from "./protocol.js";

export interface LayoutRequestOptions {
  readonly scope?: string;
  readonly keepExisting?: boolean;
  /** Measured on the calling thread; the widths are sent to the worker as a table. */
  readonly measure?: (text: string) => number;
  readonly signal?: AbortSignal;
}

export interface LayoutClient {
  /** Lays out `model`; supersedes (cancels) any request still pending. */
  layout(model: LayoutModel, opts?: LayoutRequestOptions): Promise<LayoutResult>;
  /** Cancels the pending request, if any. */
  cancel(): void;
  /** Cancels and releases the worker. */
  dispose(): void;
  /** True when layout runs in a Web Worker, false for the in-process fallback. */
  readonly offThread: boolean;
}

/** A pending layout was superseded by a newer one, cancelled or disposed. */
export class LayoutCancelledError extends Error {
  constructor(message = "layout cancelled") {
    super(message);
    this.name = "LayoutCancelledError";
  }
}

/** The minimal Worker surface the client uses (a real `Worker` satisfies it). */
export interface WorkerLike {
  postMessage(msg: LayoutRequest): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<LayoutResponse>) => unknown) | null;
  onerror: ((ev: ErrorEvent) => unknown) | null;
}

export interface LayoutWorkerOptions {
  /** Builds the worker; overrides `url`. */
  readonly workerFactory?: () => WorkerLike;
  /** Force the in-process fallback. */
  readonly inProcess?: boolean;
}

interface Pending {
  readonly id: number;
  readonly resolve: (r: LayoutResult) => void;
  readonly reject: (e: unknown) => void;
  readonly cleanup: () => void;
}

function measuredWidths(model: LayoutModel, measure: (t: string) => number): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const t of layoutTexts(model)) widths[t] = measure(t);
  return widths;
}

/**
 * A layout client backed by the module worker at `url` (default: this package's `worker.ts`,
 * resolved the way Vite and other bundlers recognise). Without `Worker` (Node, tests) it falls
 * back to running `computeLayout` in-process with the same cancellation semantics.
 */
// @tg: implements:: [[openspec:chart-layout#Layout does not block editing]]
export function createLayoutWorker(url?: string | URL, options: LayoutWorkerOptions = {}): LayoutClient {
  const factory: (() => WorkerLike) | undefined =
    options.workerFactory ??
    (options.inProcess === true || typeof Worker === "undefined"
      ? undefined
      : url !== undefined
        ? () => new Worker(url, { type: "module" }) as unknown as WorkerLike
        : () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike);
  return factory === undefined ? createInProcessLayout() : workerClient(factory);
}

function workerClient(factory: () => WorkerLike): LayoutClient {
  let worker: WorkerLike | null = null;
  let pending: Pending | null = null;
  let nextId = 1;

  const settle = (): Pending | null => {
    const p = pending;
    pending = null;
    p?.cleanup();
    return p;
  };
  const kill = (): void => {
    worker?.terminate();
    worker = null;
  };
  const cancel = (reason?: string): void => {
    const p = settle();
    if (p === null) return;
    // The worker is busy inside ELK, which cannot be interrupted: replace it.
    kill();
    p.reject(new LayoutCancelledError(reason));
  };
  const spawn = (): WorkerLike => {
    const w = factory();
    w.onmessage = (ev) => {
      const res = ev.data;
      if (pending === null || res.id !== pending.id) return;
      const p = settle()!;
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error));
    };
    w.onerror = (ev) => {
      const p = settle();
      kill();
      p?.reject(new Error(ev.message || "layout worker failed"));
    };
    return w;
  };

  return {
    offThread: true,
    layout(model, opts = {}) {
      cancel("superseded by a newer layout");
      if (opts.signal?.aborted) return Promise.reject(new LayoutCancelledError());
      const id = nextId++;
      const req: LayoutRequest = {
        type: "layout",
        id,
        model: toWireModel(model),
        ...(opts.scope === undefined ? {} : { scope: opts.scope }),
        ...(opts.keepExisting === undefined ? {} : { keepExisting: opts.keepExisting }),
        ...(opts.measure === undefined ? {} : { widths: measuredWidths(model, opts.measure) }),
      };
      return new Promise<LayoutResult>((resolve, reject) => {
        const onAbort = (): void => {
          if (pending?.id === id) cancel("aborted");
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        pending = { id, resolve, reject, cleanup: () => opts.signal?.removeEventListener("abort", onAbort) };
        worker ??= spawn();
        worker.postMessage(req);
      });
    },
    cancel: () => cancel(),
    dispose() {
      cancel("disposed");
      kill();
    },
  };
}

/**
 * Runs layout on the calling thread. A newer request rejects the older one at once; the
 * older computation stops at its next phase boundary.
 */
export function createInProcessLayout(): LayoutClient {
  let current: { controller: AbortController; reject: (e: unknown) => void } | null = null;
  const cancel = (reason?: string): void => {
    const c = current;
    current = null;
    if (c === null) return;
    c.controller.abort();
    c.reject(new LayoutCancelledError(reason));
  };
  return {
    offThread: false,
    layout(model, opts = {}) {
      cancel("superseded by a newer layout");
      if (opts.signal?.aborted) return Promise.reject(new LayoutCancelledError());
      const controller = new AbortController();
      return new Promise<LayoutResult>((resolve, reject) => {
        const me = { controller, reject };
        current = me;
        const onAbort = (): void => {
          if (current === me) cancel("aborted");
        };
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        // Start on a later task so a request superseded synchronously never runs ELK.
        setTimeout(() => {
          if (controller.signal.aborted) return;
          computeLayout(model, {
            ...(opts.scope === undefined ? {} : { scope: opts.scope }),
            ...(opts.keepExisting === undefined ? {} : { keepExisting: opts.keepExisting }),
            ...(opts.measure === undefined ? {} : { measure: opts.measure }),
            signal: controller.signal,
          }).then(
            (r) => {
              opts.signal?.removeEventListener("abort", onAbort);
              if (current !== me) return;
              current = null;
              resolve(r);
            },
            (e: unknown) => {
              opts.signal?.removeEventListener("abort", onAbort);
              if (current !== me) return;
              current = null;
              reject(e instanceof LayoutAbortedError ? new LayoutCancelledError() : e);
            },
          );
        }, 0);
      });
    },
    cancel: () => cancel(),
    dispose: () => cancel("disposed"),
  };
}
