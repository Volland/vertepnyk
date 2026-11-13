// @tg: implements:: [[openspec:electron-app#Desktop distribution]] {note: "build; electron-builder targets are in package.json, tags build them through .github/workflows/release-electron.yml"}
// Builds the main process and the preload with esbuild and the renderer with Vite into dist/.
import { build } from "esbuild";
import { build as vite } from "vite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

process.chdir(dirname(fileURLToPath(import.meta.url)));

const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: true, logLevel: "info" };
await Promise.all([
  build({ ...common, entryPoints: { main: "src/main.ts" }, outdir: "dist", outExtension: { ".js": ".cjs" } }),
  build({ ...common, entryPoints: { preload: "src/preload.ts" }, outdir: "dist", outExtension: { ".js": ".cjs" } }),
]);
await vite({ configFile: "vite.config.ts", logLevel: "warn" });
