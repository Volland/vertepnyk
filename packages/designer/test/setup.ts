// @vertep/web decides once, at import, whether it runs on Node (worker threads) or in a
// browser, by looking for `window`. happy-dom defines one, so load the package while it is
// hidden: the vertep worker then runs on worker_threads and the DOM stays available.
const g = globalThis as { window?: unknown };
const saved = Object.getOwnPropertyDescriptor(g, "window");
if (saved?.configurable) {
  delete g.window;
  try {
    await import("@vertepnyk/sim");
  } finally {
    Object.defineProperty(g, "window", saved);
  }
}

// worker_threads rejects happy-dom's URL class; use Node's
import { URL as NodeURL } from "node:url";
(globalThis as { URL: unknown }).URL = NodeURL;
