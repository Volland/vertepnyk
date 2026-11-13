/**
 * The built plugin (dist/main.js, with its assets compiled in) in Chromium against the mock `obsidian`
 * module: code blocks and embeds render, and the simulation runs on vertep's worker and
 * WebAssembly loaded from Blob URLs, with no network but this local server.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const pkg = [process.cwd(), resolve(process.cwd(), "packages/obsidian")].find((d) => existsSync(join(d, "e2e/page.html")))!;
const dist = join(pkg, "dist");
const fixtures = resolve(pkg, "../../fixtures");
const SHOT = "/private/tmp/claude-501/-Users-volodymyrpavlyshyn-Documents-work-vertep/b6326f25-4902-4ac7-8ad6-6ec759906e64/scratchpad/obsidian.png";
const MIME: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".html": "text/html", ".json": "application/json" };

let server: Server;
let base = "";
let harness = "";

test.beforeAll(async () => {
  if (!existsSync(join(dist, "main.js"))) throw new Error("run `pnpm --filter vertepnyk-obsidian run build` first");
  const out = await build({ entryPoints: [join(pkg, "e2e/harness.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" });
  harness = out.outputFiles[0]!.text;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file: string | null = null;
    if (url.pathname === "/") file = join(pkg, "e2e/page.html");
    else if (url.pathname === "/harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(harness);
      return;
    } else if (url.pathname.startsWith("/plugin/")) file = join(dist, url.pathname.slice(8));
    else if (url.pathname.startsWith("/fixtures/")) file = join(fixtures, url.pathname.slice(10));
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server.close());

test("a vertep code block renders and simulates in a note", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) external.push(r.url());
  });
  await page.goto(base);
  const mainJs = readFileSync(join(dist, "main.js"), "utf8");
  const yaml = readFileSync(join(fixtures, "traffic-light.vt.yaml"), "utf8").replace(/\n+$/, "");
  const scxml = readFileSync(join(fixtures, "traffic-light.scxml"), "utf8");
  await page.evaluate(
    async ({ mainJs, yaml, scxml }) => {
      const { app, plugin } = await window.__harness.boot(mainJs);
      app.vault.add("traffic-light.scxml", scxml);
      const loaded: any[] = [];
      const ctx = { sourcePath: "note.md", addChild: (c: any) => (c.load(), loaded.push(c)), getSectionInfo: () => null };
      plugin.codeBlocks.get("vertep")(yaml, document.getElementById("block")!, ctx);
      plugin.postProcessors[0](document.getElementById("embed")!, ctx);
      (window as any).__plugin = plugin;
    },
    { mainJs, yaml, scxml },
  );

  const block = page.locator("#block");
  await expect(block.locator(".vt-state").first()).toBeVisible();
  await expect(page.locator("#embed .vt-state").first()).toBeVisible();
  await page.waitForTimeout(800); // layout settles
  await page.screenshot({ path: SHOT, fullPage: true });

  // the simulation runs on vertep in a worker started from a Blob URL
  await block.getByTestId("open-simulation").click();
  await expect(block.getByTestId("tab-simulation")).toHaveAttribute("aria-selected", "true");
  await expect(block.getByTestId("version-badge")).toHaveAttribute("data-status", "valid");
  await block.getByTestId("sim-start").click();
  await expect(block.getByTestId("sim-config")).toContainText("red");
  await block.getByTestId("event-name").fill("fault");
  await block.getByTestId("send").click();
  await expect(block.getByTestId("sim-config")).toContainText("flashing");
  await block.getByTestId("event-name").fill("reset");
  await block.getByTestId("send").click();
  await expect(block.getByTestId("sim-config")).toContainText("red");
  await page.screenshot({ path: SHOT.replace("obsidian.png", "obsidian-sim.png"), fullPage: true });

  expect(external).toEqual([]);
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
});
