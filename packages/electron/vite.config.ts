/**
 * The renderer build: the web shell's UI, bundled for `app://vertepnyk/`. Vertep's worker and
 * WebAssembly builds are copied to `vertep/<web|ecma>/...` (as in the web shell's build), so the
 * app starts with no network.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
const simModules = resolve(workspace, "packages/sim/node_modules/@vertep");
const ASSETS = {
  web: { root: realpathSync(join(simModules, "web")), dirs: ["dist", "wasm/core", "wasm/journal"] },
  ecma: { root: realpathSync(join(simModules, "dm-ecma")), dirs: ["dist", "wasm"] },
};
const COPY = new Set([".js", ".wasm", ".json"]);

function* files(root: string, dir: string): Generator<string> {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) yield* files(root, rel);
    else if (COPY.has(extname(name))) yield rel.split(sep).join("/");
  }
}

function vertepAssets(): Plugin {
  let outDir = "";
  return {
    name: "vertepnyk-electron:vertep-assets",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const [key, pkg] of Object.entries(ASSETS)) {
        for (const dir of pkg.dirs) {
          for (const rel of files(pkg.root, dir)) {
            const to = join(outDir, "vertep", key, rel);
            mkdirSync(dirname(to), { recursive: true });
            copyFileSync(join(pkg.root, rel), to);
          }
        }
      }
    },
  };
}

export default defineConfig({
  root: resolve(here, "renderer"),
  base: "./",
  plugins: [solid(), vertepAssets()],
  worker: { format: "es" },
  build: {
    outDir: resolve(here, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome130",
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
    modulePreload: { polyfill: false },
  },
  server: { fs: { allow: [workspace, resolve(workspace, "../vertep")] } },
});
