import { describe, expect, it } from "vitest";
import type { StateLayout } from "@vertepnyk/core";
import { computeLayout, GEOMETRY, toSetLayoutCommand, transitionLabel } from "../src/index.js";
import { buildModel, generateChart, layoutViolations, withLayout, type S } from "./helpers.js";

/** A hand-written order chart: compound `checkout`, parallel `shipping` with three regions. */
const orderChart: S[] = [
  { id: "idle", on: [{ event: "start", target: "checkout" }] },
  {
    id: "checkout",
    on: [{ event: "cancel", target: "cancelled" }],
    children: [
      { id: "cart", on: [{ event: "pay", cond: "total > 0", target: "payment" }] },
      { id: "payment", on: [{ event: "ok", target: "shipping" }, { event: "fail", target: "cart" }] },
      { id: "hist", kind: "history" },
    ],
  },
  {
    id: "shipping",
    kind: "parallel",
    children: [
      { id: "pack", children: [{ id: "picking", on: [{ event: "picked", target: "packed" }] }, { id: "packed" }] },
      { id: "label", children: [{ id: "printing", on: [{ event: "printed", target: "printed" }] }, { id: "printed" }] },
      { id: "notify", children: [{ id: "mail", on: [{ target: ["sms", "done"] }] }, { id: "sms" }] },
    ],
  },
  { id: "done", kind: "final" },
  { id: "cancelled", kind: "final", on: [{ event: "log" }] },
];

const asMap = (r: Record<string, StateLayout>): Map<string, StateLayout> => new Map(Object.entries(r));

describe("computeLayout", () => {
  // @tg: verifies:: [[openspec:chart-layout#Automatic layout#Open a hand-written chart]] {level: unit}
  it("places every state of a chart without layout: no sibling overlaps, children inside parents", async () => {
    const model = buildModel(orderChart);
    const res = await computeLayout(model);
    expect(Object.keys(res.states).sort()).toEqual([...model.states.keys()].sort());
    expect(layoutViolations(model, asMap(res.states))).toEqual([]);

    // Sizes by kind: history is a small circle box, finals and atomics are labelled boxes.
    expect(res.states.hist).toMatchObject({ w: GEOMETRY.historySize, h: GEOMETRY.historySize });
    expect(res.states.idle!.h).toBe(GEOMETRY.stateHeight);
    // Compound children sit below the header.
    expect(res.states.cart!.y).toBeGreaterThanOrEqual(GEOMETRY.headerHeight);

    // Transitions: one entry per targeted transition, none for targetless ones.
    expect(res.transitions["cancelled#0"]).toBeUndefined();
    expect(res.transitions["mail#0"]).toBeDefined();
    const pay = res.transitions["cart#0"]!;
    expect(pay.route!.length).toBeGreaterThanOrEqual(2);
    expect(pay.label).toBeDefined();
  });

  it("lays parallel regions out side by side, left to right, without overlap", async () => {
    const res = await computeLayout(buildModel(orderChart));
    const regions = ["pack", "label", "notify"].map((id) => res.states[id]!);
    for (let i = 1; i < regions.length; i++) {
      expect(regions[i]!.x).toBeGreaterThanOrEqual(regions[i - 1]!.x + regions[i - 1]!.w);
    }
    const shipping = res.states.shipping!;
    for (const r of regions) expect(r.x + r.w).toBeLessThanOrEqual(shipping.w);
  });

  it("routes are absolute: a child-to-child edge starts on the source's absolute border", async () => {
    const res = await computeLayout(buildModel(orderChart));
    const co = res.states.checkout!;
    const cart = res.states.cart!;
    const [sx, sy] = res.transitions["cart#0"]!.route![0]!;
    const ax = co.x + cart.x;
    const ay = co.y + cart.y;
    expect(sx).toBeGreaterThanOrEqual(ax - 1);
    expect(sx).toBeLessThanOrEqual(ax + cart.w + 1);
    expect(sy).toBeGreaterThanOrEqual(ay - 1);
    expect(sy).toBeLessThanOrEqual(ay + cart.h + 1);
  });

  it("uses the measure function for state widths and labels", async () => {
    const model = buildModel([{ id: "a", on: [{ event: "go", target: "b" }] }, { id: "b" }]);
    const res = await computeLayout(model, { measure: (t) => (t === "a" ? 300 : 10) });
    expect(res.states.a!.w).toBe(300 + 2 * GEOMETRY.textPadX);
    expect(res.states.b!.w).toBe(GEOMETRY.stateMinWidth);
    expect(transitionLabel(model.transitions.get("a#0")!)).toBe("go");
  });

  // @tg: verifies:: [[openspec:chart-layout#Automatic layout#New state placed without moving others]] {level: unit}
  it("keeps existing entries and places only new states", async () => {
    const first = await computeLayout(buildModel(orderChart));
    // Add a top-level state and a new child of `checkout`.
    const grown: S[] = structuredClone(orderChart);
    grown.push({ id: "archived", on: [{ event: "restore", target: "idle" }] });
    grown[1]!.children!.push({ id: "review", on: [{ event: "back", target: "cart" }] });
    const model = buildModel(grown, first.states, first.transitions);

    const res = await computeLayout(model);
    // Only new states (and containers that had to grow) come back; nothing moves.
    for (const [id, e] of Object.entries(res.states)) {
      if (id === "archived" || id === "review") continue;
      const old = first.states[id]!;
      expect({ id, x: e.x, y: e.y }).toEqual({ id, x: old.x, y: old.y });
      expect(e.w).toBeGreaterThanOrEqual(old.w);
      expect(e.h).toBeGreaterThanOrEqual(old.h);
    }
    expect(Object.keys(res.states)).toContain("archived");
    expect(Object.keys(res.states)).toContain("review");
    const after = withLayout(model, res);
    expect(layoutViolations(after, after.layout)).toEqual([]);
    // Transitions touching new states get routes; untouched ones keep theirs.
    expect(res.transitions["archived#0"]).toBeDefined();
    expect(res.transitions["review#0"]).toBeDefined();
    expect(res.transitions["picking#0"]).toBeUndefined();
  });

  it("leaves every existing entry unchanged when the new state fits", async () => {
    const layout: Record<string, StateLayout> = {
      a: { x: 20, y: 20, w: 120, h: 40 },
      c: { x: 200, y: 20, w: 400, h: 300, collapsed: false },
      c1: { x: 16, y: 40, w: 100, h: 40 },
    };
    const model = buildModel(
      [{ id: "a" }, { id: "c", children: [{ id: "c1" }, { id: "c2" }] }, { id: "b" }],
      layout,
    );
    const res = await computeLayout(model);
    expect(Object.keys(res.states).sort()).toEqual(["b", "c2"]);
    const after = withLayout(model, res);
    for (const [id, e] of Object.entries(layout)) expect(after.layout.get(id)).toEqual(e);
    expect(layoutViolations(after, after.layout)).toEqual([]);
  });

  it("re-lays out everything when keepExisting is false", async () => {
    const layout = { a: { x: 500, y: 500, w: 100, h: 40 } };
    const res = await computeLayout(buildModel([{ id: "a" }, { id: "b" }], layout), { keepExisting: false });
    expect(Object.keys(res.states).sort()).toEqual(["a", "b"]);
    expect(res.states.a).not.toEqual(layout.a);
  });

  // @tg: verifies:: [[openspec:chart-layout#Explicit re-layout#Re-layout one compound state]] {level: unit}
  it("re-lays out one compound state: only its descendants are returned", async () => {
    const first = await computeLayout(buildModel(orderChart));
    const model = buildModel(orderChart, first.states, first.transitions);
    const res = await computeLayout(model, { scope: "checkout", keepExisting: false });
    expect(Object.keys(res.states).sort()).toEqual(["cart", "hist", "payment"]);
    // Transitions inside the scope only; `payment -> shipping` leaves it.
    expect(Object.keys(res.transitions).sort()).toEqual(["cart#0", "payment#1"]);
    // Routes are absolute: offset by checkout's position.
    const co = first.states.checkout!;
    const [x, y] = res.transitions["cart#0"]!.route![0]!;
    expect(x).toBeGreaterThanOrEqual(co.x);
    expect(y).toBeGreaterThanOrEqual(co.y);
    // Children stay below checkout's header and do not overlap.
    const after = withLayout(model, res);
    expect(layoutViolations(after, after.layout).filter((v) => !v.startsWith("outside parent: "))).toEqual([]);
    for (const id of ["cart", "hist", "payment"]) expect(res.states[id]!.y).toBeGreaterThanOrEqual(GEOMETRY.headerHeight);
  });

  it("collapsed states are laid out as boxes and keep their flag; hidden children get no entries", async () => {
    const model = buildModel(orderChart, { checkout: { x: 0, y: 0, w: 1, h: 1, collapsed: true } });
    const res = await computeLayout(model, { keepExisting: false });
    expect(res.states.checkout).toMatchObject({ collapsed: true, h: GEOMETRY.stateHeight });
    expect(res.states.cart).toBeUndefined();
    // `payment -> shipping` is drawn from the collapsed `checkout`.
    expect(res.transitions["payment#0"]).toBeDefined();
  });

  it("toSetLayoutCommand wraps a result in the core setLayout command", async () => {
    const res = await computeLayout(buildModel([{ id: "a" }]));
    const cmd = toSetLayoutCommand(res);
    expect(cmd.type).toBe("setLayout");
    expect(cmd.states).toEqual(res.states);
    expect(cmd.transitions).toEqual(res.transitions);
  });

  it("lays out a generated 500-state chart", async () => {
    const roots = generateChart(500, 7);
    const model = buildModel(roots);
    expect(model.states.size).toBeGreaterThanOrEqual(500);
    const t0 = performance.now();
    const res = await computeLayout(model);
    const ms = performance.now() - t0;
    console.log(`500-state layout: ${model.states.size} states, ${model.transitions.size} transitions, ${ms.toFixed(0)} ms`);
    expect(Object.keys(res.states).length).toBe(model.states.size);
    expect(layoutViolations(model, asMap(res.states))).toEqual([]);
  }, 60_000);

  it("handles container-to-descendant, cross-region, history and self transitions", async () => {
    const model = buildModel([
      {
        id: "P",
        kind: "parallel",
        on: [{ event: "x", target: "a2" }, { target: "P" }],
        children: [
          { id: "R1", children: [{ id: "a1", on: [{ event: "up", target: "P" }, { event: "x", target: "b2" }, { target: "H" }] }, { id: "a2" }, { id: "H", kind: "history" }] },
          { id: "R2", children: [{ id: "b1", on: [{ event: "out", target: "z" }] }, { id: "b2", on: [{ target: "R2" }, { target: "R1" }] }] },
        ],
      },
      { id: "z", on: [{ target: "a1" }, { target: "z" }] },
    ]);
    const res = await computeLayout(model);
    expect(layoutViolations(model, asMap(res.states))).toEqual([]);
    expect(Object.keys(res.transitions).length).toBe(model.transitions.size);
  });

  it("property: re-placing dropped entries of generated charts moves nothing and overlaps nothing", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const roots = generateChart(120, seed);
      const full = await computeLayout(buildModel(roots));
      const keep = Object.fromEntries(Object.entries(full.states).filter((_, i) => i % 10 !== 3));
      const model = buildModel(roots, keep);
      const res = await computeLayout(model);
      const after = withLayout(model, res);
      expect(layoutViolations(after, after.layout), `seed ${seed}`).toEqual([]);
      for (const [id, e] of Object.entries(keep)) {
        const n = after.layout.get(id)!;
        expect([id, n.x, n.y], `seed ${seed}`).toEqual([id, e.x, e.y]);
      }
    }
  }, 60_000);

  it("keeps a laid-out 500-state chart and places 50 new states", async () => {
    const roots = generateChart(500, 11);
    const full = await computeLayout(buildModel(roots));
    const keep = Object.fromEntries(Object.entries(full.states).filter((_, i) => i % 10 !== 5));
    const model = buildModel(roots, keep);
    const t0 = performance.now();
    const res = await computeLayout(model);
    const ms = performance.now() - t0;
    console.log(`500-state keepExisting layout: ${Object.keys(res.states).length} entries returned, ${ms.toFixed(0)} ms`);
    const after = withLayout(model, res);
    expect(layoutViolations(after, after.layout)).toEqual([]);
  }, 60_000);
});
