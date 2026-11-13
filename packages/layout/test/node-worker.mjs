// A Node worker_threads stand-in for the browser layout worker: loads src/worker.ts with
// Node's built-in type stripping (resolving the `.js` import specifiers to `.ts` sources)
// and answers the same request/response protocol.
import { registerHooks } from "node:module";
import { parentPort } from "node:worker_threads";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      try {
        return next(specifier, context);
      } catch {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
    }
    return next(specifier, context);
  },
});

const { handleLayoutRequest } = await import("../src/worker.ts");
parentPort.on("message", async (req) => {
  parentPort.postMessage(await handleLayoutRequest(req));
});
