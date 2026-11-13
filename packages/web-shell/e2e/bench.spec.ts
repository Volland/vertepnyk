import { expect, test } from "@playwright/test";

const N = 1000;

// @tg: verifies:: [[openspec:canvas-editing#Rendering performance#Large chart pan]] {level: e2e}
test("pans a 1,000-state chart for five seconds at a median frame of at most 16.7 ms", async ({ page }) => {
  await page.goto(`/?bench=${N}`);
  await page.waitForFunction(() => window.__vertepnyk?.handle !== undefined, undefined, { timeout: 60_000 });
  await expect(page.locator("[data-state-id]").first()).toBeVisible({ timeout: 60_000 });
  const total = await page.evaluate(() => window.__vertepnyk!.handle!.controller.doc.model!.states.size);
  const transitions = await page.evaluate(() => window.__vertepnyk!.handle!.controller.doc.model!.transitions.size);
  expect([total, transitions]).toEqual([N, N * 2]);
  // let validation of the big chart finish so that its result does not land in the measurement
  await page.waitForFunction(() => document.querySelector('[data-testid="version-badge"]')?.getAttribute("data-status") !== "pending", undefined, { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const pan = await page.evaluate(async () => {
    const svg = document.querySelector<SVGSVGElement>(".vt-svg")!;
    const frames: number[] = [];
    const work: number[] = [];
    const mountedPerFrame: number[] = [];
    const start = performance.now();
    let last = start;
    let n = 0;
    // pan back and forth over the chart's extent (a triangle wave), so every frame has content
    const span = 120; // frames per leg
    const leg = (k: number): number => {
      const p = k % (2 * span);
      return p < span ? 1 : -1;
    }
    await new Promise<void>((done) => {
      const tick = (now: number): void => {
        frames.push(now - last);
        last = now;
        const t0 = performance.now();
        // a diagonal sweep with a wobble: new content enters the view on every frame
        const dir = leg(n);
        svg.dispatchEvent(new WheelEvent("wheel", { deltaX: dir * (14 + (n % 5)), deltaY: dir * (9 + (n % 3)), bubbles: true, cancelable: true }));
        work.push(performance.now() - t0);
        mountedPerFrame.push(document.querySelectorAll("[data-state-id]").length);
        n++;
        if (now - start >= 5000) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const vp = (window.__vertepnyk!.handle!.canvas() as { getViewport(): { x: number; y: number } }).getViewport();
    const ms = [...mountedPerFrame].sort((a, b) => a - b);
    return { frames: frames.slice(1), work, vp, mounted: `${ms[0]}..${ms[ms.length - 1]} (median ${ms[Math.floor(ms.length / 2)]})` };
  });
  const sorted = [...pan.frames].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  const median = q(0.5);
  const workSorted = [...pan.work].sort((a, b) => a - b);
  const workMedian = workSorted[Math.floor(workSorted.length / 2)]!;
  const report = `pan ${N} states/${N * 2} transitions: ${pan.frames.length} frames over 5 s, frame interval median ${median.toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} ms, max ${sorted[sorted.length - 1]!.toFixed(2)} ms; pan handler median ${workMedian.toFixed(2)} ms; mounted states per frame ${pan.mounted}; ended at ${Math.round(pan.vp.x)},${Math.round(pan.vp.y)}`;
  console.log(report);
  test.info().annotations.push({ type: "pan", description: report });
  expect(pan.frames.length).toBeGreaterThan(200);
  // rAF timestamps are quantised to 0.1 ms; 16.7 ms is the 60 Hz frame
  expect(median).toBeLessThanOrEqual(16.8);
});

// @tg: verifies:: [[openspec:canvas-editing#Rendering performance#Large chart pan]] {level: e2e}
test("a change of the active configuration is on screen within one frame", async ({ page }) => {
  await page.goto(`/?bench=${N}`);
  await page.waitForFunction(() => window.__vertepnyk?.handle !== undefined, undefined, { timeout: 60_000 });
  await expect(page.locator("[data-state-id]").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const ids = [...document.querySelectorAll("[data-state-id]")].slice(0, 40).map((e) => e.getAttribute("data-state-id")!);
    const handle = window.__vertepnyk!.handle!;
    const flip = async (set: readonly string[] | null): Promise<{ sync: number; frame: number }> => {
      const t0 = performance.now();
      handle.setActiveOverride(set);
      const sync = performance.now() - t0;
      await new Promise((res) => requestAnimationFrame(res));
      return { sync, frame: performance.now() - t0 };
    };
    const on = await flip(ids);
    const lit = document.querySelectorAll('[data-state-id][data-active="true"]').length;
    const off = await flip(null);
    const dark = document.querySelectorAll('[data-state-id][data-active="true"]').length;
    return { ids: ids.length, on, off, lit, dark };
  });
  const report = `highlight of ${r.ids} states: applied to the DOM in ${r.on.sync.toFixed(2)} ms (visible by the next frame callback after ${r.on.frame.toFixed(2)} ms); cleared in ${r.off.sync.toFixed(2)} ms; ${r.lit} lit`;
  console.log(report);
  test.info().annotations.push({ type: "highlight", description: report });
  expect(r.lit).toBe(r.ids);
  expect(r.dark).toBe(0);
  expect(r.on.sync).toBeLessThanOrEqual(16.7);
  expect(r.off.sync).toBeLessThanOrEqual(16.7);
});
