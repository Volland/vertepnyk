/**
 * Workers in a VS Code webview.
 *
 * The page's origin is `vscode-webview://...` while the extension's files are served from
 * `https://*.vscode-cdn.net`. Two things follow, both found by running the extension in VS Code:
 *
 * 1. `new Worker(resourceUrl)` is cross-origin and throws a SecurityError.
 * 2. A blob worker that `import`s or `fetch`es a resource URL never gets an answer: the webview's
 *    service worker forwards resource requests to the page, and cannot find the page for a
 *    worker's request, so the request hangs.
 *
 * So workers are built from a blob of their own (self-contained) script, fetched by the page, and
 * every file a worker needs (the WebAssembly modules) is fetched by the page and posted in.
 */

const ASSET = "__vertepnyk_asset";

/** A worker's request for a file, answered with the bytes. */
interface AssetRequest {
  readonly [ASSET]: number;
  readonly name: string;
}

const isAssetRequest = (d: unknown): d is AssetRequest => typeof d === "object" && d !== null && typeof (d as Record<string, unknown>)[ASSET] === "number";

/** Fetches the script in the page and returns a blob URL a module worker can be built from. */
export async function workerBlobUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  return URL.createObjectURL(new Blob([await res.text()], { type: "text/javascript" }));
}

/**
 * Replaces `Worker` so that asset requests from any worker (see the vertep worker bundle's
 * `requestWasm`) are answered by `resolve(name)` with bytes fetched from the page.
 */
export function installAssetWorkers(resolve: (name: string) => Promise<ArrayBuffer>): void {
  const Base = globalThis.Worker;
  class AssetWorker extends Base {
    #user: ((e: MessageEvent) => unknown) | null = null;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      super.addEventListener("message", (e) => {
        const d: unknown = (e as MessageEvent).data;
        if (isAssetRequest(d)) {
          resolve(d.name).then(
            (bytes) => this.postMessage({ [ASSET]: d[ASSET], bytes }, [bytes]),
            (err: unknown) => this.postMessage({ [ASSET]: d[ASSET], error: String((err as Error).message ?? err) }),
          );
        } else this.#user?.(e as MessageEvent);
      });
    }
    override get onmessage(): ((e: MessageEvent) => unknown) | null {
      return this.#user;
    }
    override set onmessage(h: ((e: MessageEvent) => unknown) | null) {
      this.#user = h;
    }
  }
  globalThis.Worker = AssetWorker as unknown as typeof Worker;
}
