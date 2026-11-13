/**
 * Assembles the plugin into dist/, ready to drop into <vault>/.obsidian/plugins/vertepnyk/:
 *
 *   main.js              the plugin (CJS; obsidian, electron, @codemirror/*, @lezer/* external)
 *   manifest.json, versions.json, styles.css
 *   assets/layout-worker.js   packages/layout/src/worker.ts, self-contained (elkjs inlined)
 *   assets/vertep-worker.js   @vertep/web's worker, self-contained, WebAssembly URLs patched
 *   assets/{core,journal,ecma}/vertep_wasm.js, vertep_wasm_bg.wasm
 *
 * Solid's JSX is compiled with babel-preset-solid (found through vite-plugin-solid, which the
 * workspace already depends on) after esbuild strips the types.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, "..");
const dist = join(here, "dist");
const require = createRequire(import.meta.url);

const vitePluginSolid = require.resolve("vite-plugin-solid", { paths: [resolve(here, "../..")] });
const fromPlugin = createRequire(vitePluginSolid);
const babel = fromPlugin("@babel/core");
const solidPreset = fromPlugin.resolve("babel-preset-solid");

/** `.tsx`: strip types with esbuild, then compile JSX for Solid's DOM renderer. */
const solid = {
  name: "solid",
  setup(b) {
    b.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const src = readFileSync(args.path, "utf8");
      const ts = await transform(src, { loader: "tsx", jsx: "preserve", sourcefile: args.path, tsconfigRaw: { compilerOptions: { jsx: "preserve", verbatimModuleSyntax: true } } });
      const out = await babel.transformAsync(ts.code, { filename: args.path, presets: [[solidPreset, { generate: "dom", hydratable: false }]], sourceMaps: false, babelrc: false, configFile: false });
      return { contents: out.code, loader: "js", resolveDir: dirname(args.path) };
    });
  },
};

const simModules = join(packages, "sim/node_modules/@vertep");
const vertepWeb = realpathSync(join(simModules, "web"));
const vertepEcma = realpathSync(join(simModules, "dm-ecma"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const common = { bundle: true, target: "es2022", logLevel: "info", legalComments: "none" };

// ---- the plugin ---------------------------------------------------------------------------
await build({
  ...common,
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(dist, "main.js"),
  format: "cjs",
  platform: "browser",
  conditions: ["solid", "browser", "import", "module"],
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`), "@vertep/dm-ecma"],
  define: { "process.env.NODE_ENV": '"production"', "import.meta.url": '"file:///vertepnyk/"' },
  plugins: [solid],
  sourcemap: false,
  minify: true,
  mainFields: ["module", "main"],
});

// ---- the layout worker ----------------------------------------------------------------------
await build({
  ...common,
  entryPoints: [join(packages, "layout/src/worker.ts")],
  outfile: join(dist, "assets/layout-worker.js"),
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});

// ---- vertep's worker ------------------------------------------------------------------------
// The worker looks its WebAssembly build up with `new URL("../wasm/<kind>/...", import.meta.url)`,
// which does not exist in a Blob URL. The plugin puts `globalThis.__VERTEP_BUILDS` (Blob URLs)
// in front of the bundle; the lookup reads that instead.
let patched = 0;
await build({
  ...common,
  entryPoints: [join(vertepWeb, "dist/worker.js")],
  outfile: join(dist, "assets/vertep-worker.js"),
  format: "esm",
  platform: "browser",
  external: ["node:*"],
  minify: false,
  plugins: [
    {
      name: "vertep-worker-builds",
      setup(b) {
        b.onLoad({ filter: /dist[\\/]worker\.js$/ }, (args) => {
          const src = readFileSync(args.path, "utf8");
          const out = src
            .replace(/new URL\(`\.\.\/wasm\/\$\{kind\}\/vertep_wasm\.js`, import\.meta\.url\)\.href/, () => (patched++, "globalThis.__VERTEP_BUILDS[kind].glue"))
            .replace(/new URL\(`\.\.\/wasm\/\$\{kind\}\/vertep_wasm_bg\.wasm`, import\.meta\.url\)\.href/, () => (patched++, "globalThis.__VERTEP_BUILDS[kind].wasm"));
          return { contents: out, loader: "js", resolveDir: dirname(args.path) };
        });
      },
    },
  ],
});
if (patched !== 2) throw new Error(`vertep's worker changed: expected to patch 2 WebAssembly lookups, patched ${patched}`);

// ---- WebAssembly builds and static files ----------------------------------------------------
const copy = (from, to) => {
  if (!existsSync(from)) throw new Error(`missing ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};
for (const [dir, root, sub] of [["core", vertepWeb, "wasm/core"], ["journal", vertepWeb, "wasm/journal"], ["ecma", vertepEcma, "wasm"]]) {
  for (const f of ["vertep_wasm.js", "vertep_wasm_bg.wasm"]) copy(join(root, sub, f), join(dist, "assets", dir, f));
}
for (const f of ["manifest.json", "versions.json"]) copy(join(here, "static", f), join(dist, f));
copy(join(here, "styles.css"), join(dist, "styles.css"));
copy(join(here, "../../LICENSE-MIT"), join(dist, "LICENSE-MIT"));
writeFileSync(join(dist, "assets/README.txt"), "WebAssembly builds and workers of the vertepnyk plugin. Do not remove: the plugin loads them from here without network access.\n");
console.log("vertepnyk-obsidian: built", dist);
