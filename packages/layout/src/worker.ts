/**
 * The layout Web Worker. ELK runs inside this worker's thread (elkjs's bundled build with its
 * in-thread "fake worker"), so a busy layout never blocks the UI and the client can cancel it
 * by terminating the worker.
 *
 * Start it as a module worker: `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.
 */
import { computeLayout, defaultMeasure } from "./layout.js";
import type { LayoutRequest, LayoutResponse } from "./protocol.js";

/** Runs one request; the worker's message handler, also usable in-process. */
export async function handleLayoutRequest(req: LayoutRequest): Promise<LayoutResponse> {
  const widths = req.widths;
  try {
    const result = await computeLayout(req.model, {
      ...(req.scope === undefined ? {} : { scope: req.scope }),
      ...(req.keepExisting === undefined ? {} : { keepExisting: req.keepExisting }),
      ...(widths === undefined ? {} : { measure: (t: string) => widths[t] ?? defaultMeasure(t) }),
    });
    return { id: req.id, ok: true, result };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(msg: LayoutResponse): void;
}

const workerGlobal = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;

if (workerGlobal !== undefined && globalThis instanceof workerGlobal) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (ev) => {
    if (ev.data?.type !== "layout") return;
    void handleLayoutRequest(ev.data).then((res) => scope.postMessage(res));
  };
}
