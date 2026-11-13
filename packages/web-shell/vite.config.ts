import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
// `@vertep/web` and `@vertep/dm-ecma` are linked from the vertep checkout; the packages are
// resolved through sim, which depends on them (pnpm does not hoist them to the shell).
const simModules = resolve(workspace, "packages/sim/node_modules/@vertep");
const vertepWeb = realpathSync(join(simModules, "web"));
const vertepEcma = realpathSync(join(simModules, "dm-ecma"));

/** What of each package the browser needs: the worker and glue modules, and the wasm builds. */
const ASSETS: Record<string, { root: string; dirs: readonly string[] }> = {
  web: { root: vertepWeb, dirs: ["dist", "wasm/core", "wasm/journal"] },
  ecma: { root: vertepEcma, dirs: ["dist", "wasm"] },
};

const MIME: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };

function* files(root: string, dir: string): Generator<string> {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) yield* files(root, rel);
    else if (MIME[extname(name)]) yield rel.split(sep).join("/");
  }
}

/**
 * Serves vertep's worker and WebAssembly builds under `/vertep/<web|ecma>/...` in dev and
 * copies them there in the build, laid out as in the packages so the worker's relative URLs
 * (`../wasm/core/vertep_wasm.js`) resolve unchanged.
 */
function vertepAssets(): Plugin {
  let outDir = "dist";
  return {
    name: "vertepnyk:vertep-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/^\/vertep\/(web|ecma)\/([^?#]+)/);
        if (!m) return next();
        const pkg = ASSETS[m[1]!]!;
        const rel = decodeURIComponent(m[2]!);
        const abs = resolve(pkg.root, rel);
        if (!abs.startsWith(pkg.root + sep) || !pkg.dirs.some((d) => rel.startsWith(`${d}/`)) || !existsSync(abs)) return next();
        res.setHeader("Content-Type", MIME[extname(abs)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(abs).pipe(res);
      });
    },
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
  plugins: [solid(), vertepAssets()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ["@vertep/web", "@vertep/dm-ecma"] },
  server: {
    port: Number(process.env.PORT ?? 5173),
    fs: { allow: [workspace, resolve(workspace, "../vertep-layout-ns")] },
  },
  preview: { port: Number(process.env.PORT ?? 4173) },
});
