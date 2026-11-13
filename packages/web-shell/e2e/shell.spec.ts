import { expect, test, type Page } from "@playwright/test";

const state = (page: Page, id: string) => page.locator(`[data-state-id="${id}"]`).first();
const active = (page: Page, id: string) => expect(state(page, id)).toHaveAttribute("data-active", "true");

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId("version-badge")).toHaveAttribute("data-status", "valid", { timeout: 40_000 });
}

async function send(page: Page, event: string, payload = ""): Promise<void> {
  await page.getByTestId("event-name").fill(event);
  await page.getByTestId("event-payload").fill(payload);
  await page.getByTestId("send").click();
}

test.describe("web shell", () => {
  // @tg: verifies:: [[openspec:web-shell#Browser host#Load and simulate in the browser]] {level: e2e}
  test("loads the order example and simulates it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("file-name")).toContainText("order.scxml");
    await ready(page);
    await page.getByTestId("tab-simulation").click();
    await page.getByTestId("sim-start").click();
    await active(page, "cart");
    await send(page, "add");
    await expect(page.getByTestId("context-row").filter({ hasText: "items" }).locator(".vd-ctxval")).toHaveText("1");
    await expect(page.getByTestId("context-row").filter({ hasText: "items" })).toHaveAttribute("data-changed", "true");
    await send(page, "checkout");
    await active(page, "awaiting_payment");
    await expect(state(page, "cart")).toHaveAttribute("data-active", "false");
  });

  // @tg: verifies:: [[openspec:chart-layout#Layout does not block editing#Large chart layout]] {level: e2e}
  test("lays out an unplaced chart in a Web Worker and the canvas stays responsive", async ({ page }) => {
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByTestId("file-name").waitFor();
    await ready(page);
    // states are drawn provisionally at first; once the worker answers none is provisional
    await expect(page.locator("[data-state-id]").first()).toBeVisible();
    await expect(page.locator('[data-state-id][data-provisional="true"]')).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => workers.some((u) => /layout|worker/i.test(u))).toBe(true);
    expect(errors.filter((m) => /Worker/.test(m))).toEqual([]);
  });

  // @tg: verifies:: [[openspec:web-shell#Side-by-side text#Type in the text]] {level: e2e}
  test("a state typed in the text pane appears on the canvas, and visual edits reach the text", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    // the document ends with </scxml>; insert a state before it
    for (let i = 0; i < "</scxml>\n".length; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.type('<state id="refunded"/>');
    await expect(state(page, "refunded")).toBeVisible();
    await expect(page.getByTestId("dirty")).toBeVisible();
    // and back: a visual edit is written into the editor
    await page.getByTestId("tab-inspector").click();
    await page.evaluate(() => {
      const h = window.__vertepnyk!.handle!;
      h.controller.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "from_canvas" });
    });
    await expect(page.locator(".cm-content")).toContainText("from_canvas");
    await expect(state(page, "from_canvas")).toBeVisible();
  });

  // @tg: verifies:: [[openspec:web-shell#Local file access#Save without file system access]] {level: e2e}
  test("saves by download under the original name when the browser has no file access", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    });
    await page.goto("/");
    await ready(page);
    const download = page.waitForEvent("download");
    await page.getByTestId("save").click();
    const d = await download;
    expect(d.suggestedFilename()).toBe("order.scxml");
    const text = await (await import("node:fs/promises")).readFile((await d.path())!, "utf8");
    expect(text).toContain('<state id="cart"');
  });

  // @tg: verifies:: [[openspec:web-shell#Example gallery#Open the traffic light]] {level: e2e}
  test("opens the traffic light example laid out and ready to simulate", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByTestId("examples").selectOption("traffic-light");
    await expect(page.getByTestId("file-name")).toContainText("traffic-light.scxml");
    await expect(page.locator("[data-state-id]").first()).toBeVisible();
    await expect(page.locator('[data-state-id][data-provisional="true"]')).toHaveCount(0, { timeout: 30_000 });
    await ready(page);
    await page.getByTestId("tab-simulation").click();
    await page.getByTestId("sim-start").click();
    await expect(page.locator('[data-state-id][data-active="true"]').first()).toBeVisible();
  });

  test("opens the typed YAML example and refuses an ill-typed payload", async ({ page }) => {
    await page.goto("/?example=typed-order");
    await ready(page);
    await page.getByTestId("tab-simulation").click();
    await page.getByTestId("sim-start").click();
    await active(page, "cart");
    await send(page, "add", '{"sku":"B","qty":1,"price":"10"}');
    await send(page, "checkout");
    await active(page, "payment");
    await send(page, "pay", '{"amount":"ten","method":{"tag":"Invoice"}}');
    await expect(page.getByTestId("sim-error")).toContainText("amount");
  });
});
