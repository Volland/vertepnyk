import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const pkg = resolve(here, "..");
export const fixtures = resolve(pkg, "../../fixtures");

/** A temp directory holding copies of the named fixtures (never the originals), optionally renamed. */
export function tempCopies(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vertepnyk-e2e-"));
  const paths = Object.entries(files).map(([as, fixture]) => {
    const to = join(dir, as);
    copyFileSync(join(fixtures, fixture), to);
    return to;
  });
  return { dir, paths };
}

export async function launch(paths: readonly string[] = []): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), "vertepnyk-userdata-"));
  // a shell that exports ELECTRON_RUN_AS_NODE would make Electron behave as plain Node
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined)) as Record<string, string>;
  const app = await _electron.launch({ args: [".", `--user-data-dir=${userData}`, ...paths], cwd: pkg, env });
  return { app, userData };
}

export const ready = async (page: Page): Promise<void> => {
  await page.getByTestId("version-badge").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="version-badge"]')?.getAttribute("data-status") === "valid", undefined, { timeout: 60_000 });
};

export const state = (page: Page, id: string) => page.locator(`[data-state-id="${id}"]`).first();

/** The app's windows once `n` have a loaded designer. */
export async function windowsReady(app: ElectronApplication, n: number): Promise<Page[]> {
  const deadline = Date.now() + 60_000;
  while (app.windows().length < n && Date.now() < deadline) await app.waitForEvent("window", { timeout: 60_000 });
  const pages = app.windows();
  for (const p of pages) await p.waitForFunction(() => window.__vertepnyk?.handle !== undefined, undefined, { timeout: 60_000 });
  return pages;
}
