// Launches VS Code with the built extension and runs test/integration/suite.ts inside it.
// Downloads VS Code through @vscode/test-electron unless VERTEPNYK_VSCODE_PATH names an executable.
import { build } from "esbuild";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "../..");
if (!existsSync(join(pkg, "dist/extension.cjs"))) throw new Error("build first: pnpm --filter vertepnyk-vscode run build");

const out = mkdtempSync(join(tmpdir(), "vertepnyk-it-"));
await build({ entryPoints: [join(here, "suite.ts")], outfile: join(out, "suite.cjs"), bundle: true, platform: "node", format: "cjs", external: ["vscode"], logLevel: "warning" });

const workspace = join(out, "workspace");
mkdirSync(workspace);
cpSync(resolve(pkg, "../../fixtures/order.scxml"), join(workspace, "order.scxml"));
cpSync(resolve(pkg, "../../fixtures/traffic-light.vt.yaml"), join(workspace, "traffic-light.vt.yaml"));

// a parent Electron app (an editor terminal) may leak this, which turns VS Code into plain Node
delete process.env.ELECTRON_RUN_AS_NODE;

// VS Code 1.14x names the macOS binary `Code`; test-electron still guesses `Electron`
let executable = process.env.VERTEPNYK_VSCODE_PATH;
if (!executable) {
  executable = await downloadAndUnzipVSCode(process.env.VERTEPNYK_VSCODE_VERSION ?? "stable");
  if (process.platform === "darwin" && !existsSync(executable)) executable = join(dirname(executable), "Code");
}
// With VERTEPNYK_SCREENSHOT=<png>, VS Code is started with a debugging port; once the suite has
// the designer on screen it writes `ready` and this process captures the window over CDP.
const shot = process.env.VERTEPNYK_SCREENSHOT;
const port = 9333;
async function capture() {
  const { chromium } = await import("@playwright/test");
  let browser;
  for (let i = 0; i < 120 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    if (!browser) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!browser) return console.log("screenshot: no CDP endpoint");
  while (!existsSync(join(out, "ready"))) await new Promise((r) => setTimeout(r, 500));
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => /workbench/.test(p.url())) ?? pages[0];
  await page.screenshot({ path: shot });
  console.log(`screenshot written: ${shot}`);
  writeFileSync(join(out, "shot-done"), "");
  await browser.close();
}
const capturing = shot ? capture().catch((e) => console.log(`screenshot failed: ${e}`)) : undefined;
try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(out, "suite.cjs"),
    extensionTestsEnv: { VERTEPNYK_SCREENSHOT: shot ?? "", VERTEPNYK_SIGNAL_DIR: out },
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", ...(shot ? [`--remote-debugging-port=${port}`] : []), `--user-data-dir=${join(out, "user-data")}`],
  });
  await capturing;
} finally {
  rmSync(out, { recursive: true, force: true });
}
