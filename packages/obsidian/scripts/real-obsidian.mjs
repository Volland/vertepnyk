/**
 * The built plugin in real Obsidian (desktop, opt-in): `pnpm --filter vertepnyk-obsidian run test:real`.
 *
 * Installs dist/main.js, manifest.json and styles.css (what the community directory installs)
 * into a throwaway vault, starts Obsidian with a throwaway profile and remote debugging, trusts
 * the vault, and checks over the DevTools protocol that the plugin:
 *
 *   - loads;
 *   - opens a chart file in the designer and validates it to a version IRI;
 *   - starts a simulation and takes a step;
 *   - renders a `vertep` code block in a note;
 *   - logs no errors.
 *
 * Needs Obsidian installed (OBSIDIAN_BIN, default /Applications/Obsidian.app/Contents/MacOS/Obsidian)
 * and Playwright from the electron package. Your own Obsidian profile and vaults are not touched.
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");
const { chromium } = createRequire(join(repo, "packages/electron/package.json"))("@playwright/test");
const bin = process.env.OBSIDIAN_BIN ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const port = 9300 + Math.floor(Math.random() * 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = mkdtempSync(join(tmpdir(), "vertepnyk-obsidian-"));
const vault = join(tmp, "vault");
const plugin = join(vault, ".obsidian/plugins/vertepnyk");
mkdirSync(plugin, { recursive: true });
mkdirSync(join(tmp, "profile"));
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(pkg, "dist", f), join(plugin, f));
writeFileSync(join(vault, ".obsidian/community-plugins.json"), '["vertepnyk"]');
copyFileSync(join(repo, "fixtures/refund.scxml"), join(vault, "refund.scxml"));
writeFileSync(join(vault, "Note.md"), "# Light\n\n```vertep\n" + readFileSync(join(repo, "fixtures/traffic-light.scxml"), "utf8") + "\n```\n");
writeFileSync(join(tmp, "profile/obsidian.json"), JSON.stringify({ vaults: { a1b2c3d4e5f60718: { path: vault, ts: Date.now(), open: true } } }));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const proc = spawn(bin, [`--user-data-dir=${join(tmp, "profile")}`, `--remote-debugging-port=${port}`], { env, stdio: "ignore" });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
let browser;
try {
  for (let i = 0; i < 60 && !browser; i++) browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => sleep(500).then(() => undefined));
  if (!browser) throw new Error("Obsidian did not open a debugging port");
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
    if (!page) await sleep(500);
  }
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForLoadState("domcontentloaded");
  const trust = page.getByText("Trust author and enable plugins");
  await trust.first().waitFor({ timeout: 15000 }).then(() => trust.first().click()).catch(() => undefined);
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!globalThis.app?.plugins?.plugins?.vertepnyk)); i++) await sleep(500);
  check(await page.evaluate(() => !!app.plugins.plugins.vertepnyk), "the plugin loads");

  await page.evaluate(async () => app.workspace.getLeaf(true).openFile(app.vault.getAbstractFileByPath("refund.scxml")));
  const leaf = page.locator(".workspace-leaf.mod-active");
  check((await page.evaluate(() => app.workspace.activeLeaf?.view?.getViewType())) === "vertepnyk-designer", "a chart file opens in the designer");
  let version;
  for (let i = 0; i < 40 && !version; i++) {
    version = (await leaf.innerText()).match(/sha256:[0-9a-f]{64}/)?.[0];
    if (!version) await sleep(500);
  }
  check(!!version, `the chart validates to a version (${version ?? "none"})`);

  await leaf.getByRole("button", { name: "Simulate" }).first().click();
  await leaf.getByText("Simulation", { exact: true }).first().click();
  // the simulator is running once it shows the configuration and the enabled events
  await leaf.getByText("CONFIGURATION", { exact: false }).first().waitFor({ timeout: 20000 });
  await leaf.getByText("request", { exact: true }).last().waitFor({ timeout: 20000 });
  await leaf.getByText("request", { exact: true }).last().click();
  await leaf.getByRole("button", { name: "Send" }).first().click();
  let stepped = false;
  for (let i = 0; i < 20 && !stepped; i++) {
    stepped = /idle → review/.test(await leaf.innerText());
    if (!stepped) await sleep(500);
  }
  check(stepped, "the simulation takes a step (idle → review)");

  await page.evaluate(async () => {
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(app.vault.getAbstractFileByPath("Note.md"));
    await leaf.setViewState({ type: "markdown", state: { file: "Note.md", mode: "preview" } });
  });
  let blocks = 0;
  for (let i = 0; i < 20 && blocks === 0; i++) {
    blocks = await page.locator(".workspace-leaf.mod-active .vertepnyk-block").count();
    if (blocks === 0) await sleep(500);
  }
  check(blocks > 0, "a vertep code block renders in a note");
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  failures.push(String(e));
  console.log(`FAIL ${e}`);
} finally {
  await browser?.close().catch(() => undefined);
  proc.kill();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures.length ? 1 : 0);
