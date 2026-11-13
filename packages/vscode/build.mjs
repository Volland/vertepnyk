// Builds the extension: host bundle, webview bundle, layout worker, and vertep's worker/wasm.
import { build as esbuild } from "esbuild";
import { build as vite } from "vite";
import solid from "vite-plugin-solid";
import { cpSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const production = process.env.NODE_ENV !== "development";

/**
 * The packaged assets are copied next to the bundle and loaded by URL, so the default
 * bundler-detected worker and wasm references (never taken, every URL is passed in) are cut
 * out instead of being emitted as extra files.
 */
const noImplicitAssets = () => ({
  name: "vertepnyk:no-implicit-assets",
  enforce: "pre",
  resolveId: (id) => (id === "@vertep/dm-ecma" ? "\0dm-ecma-stub" : null),
  load: (id) => (id === "\0dm-ecma-stub" ? "export const ecmascript = undefined;" : null),
  transform(code, id) {
    if (/layout\/src\/client\.ts$/.test(id)) return code.replace(/new Worker\(new URL\("\.\/worker\.ts", import\.meta\.url\), \{ type: "module" \}\)/, "(() => { throw new Error('a layout worker URL is required'); })()");
    if (/web\/dist\/client\.js$/.test(id)) return code.replace(/new URL\("\.\/worker\.js", import\.meta\.url\)/, "(() => { throw new Error('a workerUrl is required'); })()");
    return null;
  },
});

// 1. extension host (Node, CommonJS; `vscode` is provided by the host)
await esbuild({
  entryPoints: [join(here, "src/extension.ts")],
  outfile: join(dist, "extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  minify: production,
  logLevel: "warning",
});

// 2. layout worker (ELK in a module worker; loaded through a blob wrapper, see src/webview/worker.ts)
await esbuild({
  entryPoints: [resolve(here, "../layout/src/worker.ts")],
  outfile: join(dist, "layout-worker.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  minify: production,
  logLevel: "warning",
});

// 3. webview (Solid needs its JSX transform, so Vite builds this one)
await vite({
  configFile: false,
  // vite-plugin-solid dedupes solid-js from the root, and only the designer package has it
  root: resolve(here, "../designer"),
  logLevel: "warn",
  plugins: [noImplicitAssets(), solid()],
  worker: { format: "es" },
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: "es2022",
    minify: production,
    sourcemap: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: join(here, "src/webview/main.ts"),
      preserveEntrySignatures: false,
      output: { format: "es", inlineDynamicImports: true, entryFileNames: "webview.js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});

// 4. vertep's worker as one self-contained script (see src/webview/worker.ts for why): the glue
// of the three builds is bundled in, and the wasm bytes are asked of the page.
const sim = join(here, "../sim/node_modules/@vertep");
const web = realpathSync(join(sim, "web"));
const ecma = realpathSync(join(sim, "dm-ecma"));
const workerEntry = `
import * as core from ${JSON.stringify(join(web, "wasm/core/vertep_wasm.js"))};
import * as journal from ${JSON.stringify(join(web, "wasm/journal/vertep_wasm.js"))};
import * as ecma from ${JSON.stringify(join(ecma, "wasm/vertep_wasm.js"))};
globalThis.__vertepGlue = { core, journal, ecma };
import ${JSON.stringify(join(web, "dist/worker.js"))};
`;
const patchWorker = () => ({
  name: "vertepnyk:patch-vertep-worker",
  setup(b) {
    b.onResolve({ filter: /^vertep-worker-entry$/ }, () => ({ path: "vertep-worker-entry", namespace: "entry" }));
    b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ contents: workerEntry, resolveDir: web, loader: "js" }));
    b.onLoad({ filter: /web\/dist\/worker\.js$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      let code = await readFile(args.path, "utf8");
      const swaps = [
        ["glue: new URL(`../wasm/${kind}/vertep_wasm.js`, import.meta.url).href,", "glue: `glue:${kind}`,"],
        ["wasm: new URL(`../wasm/${kind}/vertep_wasm_bg.wasm`, import.meta.url).href,", "wasm: `wasm:${kind}`,"],
        ["const glue = (await import(build.glue));", "const glue = globalThis.__vertepGlue[build.glue.slice(5)];"],
        ["await glue.default({ module_or_path: new URL(build.wasm) });", "await glue.default({ module_or_path: await requestWasm(build.wasm) });"],
      ];
      for (const [from, to] of swaps) {
        if (!code.includes(from)) throw new Error(`@vertep/web worker changed: cannot patch ${from}`);
        code = code.replace(from, to);
      }
      code += `
let assetId = 0;
const assetWaiters = new Map();
globalThis.addEventListener("message", (e) => {
  const d = e.data;
  const w = d && typeof d === "object" ? assetWaiters.get(d.__vertepnyk_asset) : undefined;
  if (!w) return;
  assetWaiters.delete(d.__vertepnyk_asset);
  d.error ? w.reject(new Error(d.error)) : w.resolve(d.bytes);
});
function requestWasm(name) {
  return new Promise((resolve, reject) => {
    const id = ++assetId;
    assetWaiters.set(id, { resolve, reject });
    globalThis.postMessage({ __vertepnyk_asset: id, name });
  });
}
`;
      return { contents: code, loader: "js", resolveDir: dirname(args.path) };
    });
  },
});
await esbuild({
  entryPoints: ["vertep-worker-entry"],
  outfile: join(dist, "vertep-worker.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  external: ["node:*"],
  plugins: [patchWorker()],
  sourcemap: true,
  minify: production,
  logLevel: "warning",
});

// 5. the WebAssembly modules, fetched by the page and handed to the worker
const wasm = { "web/wasm/core": join(web, "wasm/core"), "web/wasm/journal": join(web, "wasm/journal"), "ecma/wasm": join(ecma, "wasm") };
for (const [to, from] of Object.entries(wasm)) {
  mkdirSync(join(dist, "vertep", to), { recursive: true });
  cpSync(join(from, "vertep_wasm_bg.wasm"), join(dist, "vertep", to, "vertep_wasm_bg.wasm"));
}
console.log("built", dist);
