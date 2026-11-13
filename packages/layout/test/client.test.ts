import * as nodeModule from "node:module";
import { Worker as NodeWorker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeLayout,
  createInProcessLayout,
  createLayoutWorker,
  LayoutCancelledError,
  type LayoutClient,
  type LayoutRequest,
  type LayoutResponse,
  type WorkerLike,
} from "../src/index.js";
import { handleLayoutRequest } from "../src/worker.js";
import { buildModel, generateChart } from "./helpers.js";

/** The worker-thread tests load src/worker.ts with Node's type stripping (Node >= 22.18). */
const canRunTsWorker =
  typeof (nodeModule as { registerHooks?: unknown }).registerHooks === "function" &&
  Boolean((process.features as { typescript?: unknown }).typescript);

const small = buildModel([{ id: "a", on: [{ event: "go", target: "b" }] }, { id: "b" }]);

/** A Web-Worker-shaped wrapper over a real Node worker thread running src/worker.ts. */
function nodeWorker(log: string[]): WorkerLike {
  const w = new NodeWorker(new URL("./node-worker.mjs", import.meta.url));
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (msg: LayoutRequest) => w.postMessage(msg),
    terminate: () => {
      log.push("terminate");
      void w.terminate();
    },
  };
  w.on("message", (data: LayoutResponse) => like.onmessage?.({ data } as MessageEvent<LayoutResponse>));
  w.on("error", (err: Error) => like.onerror?.({ message: err.message } as ErrorEvent));
  log.push("spawn");
  return like;
}

/** An in-thread fake worker that answers after `delay` ms. */
function fakeWorker(log: string[], delay = 20): WorkerLike {
  let dead = false;
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      log.push(`request ${msg.id}`);
      const clone = structuredClone(msg);
      setTimeout(() => {
        void handleLayoutRequest(clone).then((res) => {
          if (!dead) like.onmessage?.({ data: res } as MessageEvent<LayoutResponse>);
        });
      }, delay);
    },
    terminate() {
      dead = true;
      log.push("terminate");
    },
  };
  log.push("spawn");
  return like;
}

let client: LayoutClient | undefined;
afterEach(() => {
  client?.dispose();
  client = undefined;
});

describe("layout client", () => {
  it("falls back to in-process layout where Worker does not exist", async () => {
    client = createLayoutWorker();
    expect(client.offThread).toBe(false);
    const res = await client.layout(small);
    expect(res).toEqual(await computeLayout(small));
  });

  it("in-process: a newer request supersedes an older one", async () => {
    client = createInProcessLayout();
    const first = client.layout(small);
    const second = client.layout(small, { keepExisting: false });
    await expect(first).rejects.toBeInstanceOf(LayoutCancelledError);
    expect(Object.keys((await second).states).sort()).toEqual(["a", "b"]);
  });

  it("worker: a newer request terminates the busy worker and the older promise rejects", async () => {
    const log: string[] = [];
    client = createLayoutWorker(undefined, { workerFactory: () => fakeWorker(log) });
    expect(client.offThread).toBe(true);
    const first = client.layout(small);
    const second = client.layout(small);
    await expect(first).rejects.toBeInstanceOf(LayoutCancelledError);
    await expect(second).resolves.toEqual(await computeLayout(small));
    expect(log).toEqual(["spawn", "request 1", "terminate", "spawn", "request 2"]);
  });

  it("worker: an AbortSignal cancels the pending request", async () => {
    const log: string[] = [];
    client = createLayoutWorker(undefined, { workerFactory: () => fakeWorker(log) });
    const ac = new AbortController();
    const p = client.layout(small, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(LayoutCancelledError);
    expect(log).toContain("terminate");
  });

  it("worker: label widths measured on the calling thread reach the worker", async () => {
    client = createLayoutWorker(undefined, { workerFactory: () => fakeWorker([]) });
    const res = await client.layout(small, { measure: (t) => (t === "a" ? 400 : 5) });
    expect(res.states.a!.w).toBe(432);
  });

  // @tg: verifies:: [[openspec:chart-layout#Layout does not block editing#Large chart layout]] {level: integration}
  it.skipIf(!canRunTsWorker)("worker thread: a 500-state layout leaves the calling thread responsive", async () => {
    const log: string[] = [];
    client = createLayoutWorker(undefined, { workerFactory: () => nodeWorker(log) });
    const model = buildModel(generateChart(500, 7));

    // Warm up: worker start-up and the ELK bundle's parse are not layout time.
    await client.layout(small);

    let ticks = 0;
    let maxGap = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      ticks++;
    }, 5);
    const t0 = performance.now();
    const res = await client.layout(model);
    const ms = performance.now() - t0;
    clearInterval(timer);
    console.log(`worker 500-state layout: ${ms.toFixed(0)} ms, ${ticks} UI ticks, longest UI stall ${maxGap.toFixed(0)} ms`);

    expect(Object.keys(res.states).length).toBe(model.states.size);
    expect(maxGap).toBeLessThan(100);
    expect(ticks).toBeGreaterThan(ms / 50);
  }, 60_000);

  it.skipIf(!canRunTsWorker)("worker thread: superseding a running 500-state layout kills it and the newer one wins", async () => {
    const log: string[] = [];
    client = createLayoutWorker(undefined, { workerFactory: () => nodeWorker(log) });
    const big = client.layout(buildModel(generateChart(500, 3)));
    await new Promise((r) => setTimeout(r, 50));
    const next = client.layout(small);
    await expect(big).rejects.toBeInstanceOf(LayoutCancelledError);
    expect(Object.keys((await next).states).sort()).toEqual(["a", "b"]);
    expect(log).toEqual(["spawn", "terminate", "spawn"]);
  }, 60_000);
});
