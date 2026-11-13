import { describe, expect, it } from "vitest";
import {
  ChartDocument,
  EditError,
  applyPatches,
  detectFormat,
  newChart,
  uniqueId,
  type DocumentChange,
} from "../src/index.js";
import { diff, fixture } from "./helpers.js";

const ORDER_YAML = `# An order chart.
# 1
# 2
# 3
# 4
# 5
# 6
# 7
# 8
# 9
vertep: 1
name: order
states:
  cart:
    on:
      checkout: payment
  payment:
    on:
      pay: paid
      fail: failed
  failed:
    on: { back: cart }
  paid: { type: final }
`;

describe("chart-document scenarios", () => {
  // @tg: verifies:: [[openspec:chart-document#Supported chart formats#Open an SCXML chart]] {level: unit}
  it("opens an SCXML chart with every state and transition", () => {
    const doc = ChartDocument.open(fixture("order.scxml"), "scxml");
    expect(doc.error).toBeNull();
    const m = doc.model!;
    expect([...m.states.keys()]).toEqual(["cart", "awaiting_payment", "paid", "expired"]);
    expect([...m.transitions.keys()]).toEqual(["cart#0", "cart#1", "awaiting_payment#0", "awaiting_payment#1"]);
    for (const t of m.transitions.values()) for (const x of t.targets) expect(m.states.has(x)).toBe(true);
  });

  // @tg: verifies:: [[openspec:chart-document#Supported chart formats#Open a YAML chart]] {level: unit}
  it("opens a YAML chart with a vertep: 1 header with every state and transition", () => {
    const doc = ChartDocument.open(ORDER_YAML, "yaml");
    expect(doc.error).toBeNull();
    const m = doc.model!;
    expect([...m.states.keys()]).toEqual(["cart", "payment", "failed", "paid"]);
    expect([...m.transitions.values()].map((t) => `${t.source}-${t.events.join()}->${t.targets.join()}`)).toEqual([
      "cart-checkout->payment",
      "payment-pay->paid",
      "payment-fail->failed",
      "failed-back->cart",
    ]);
  });

  // @tg: verifies:: [[openspec:chart-document#Supported chart formats#Format is kept on save]] {level: unit}
  it("keeps the YAML format after an edit", () => {
    const doc = ChartDocument.open(ORDER_YAML, "yaml");
    doc.apply({ type: "addState", parent: null, kind: "atomic", id: "refunded" });
    expect(doc.format).toBe("yaml");
    expect(doc.text.startsWith("# An order chart.\n")).toBe(true);
    expect(doc.text).toContain("  refunded: {}\n");
    expect(ChartDocument.open(doc.text, "yaml").error).toBeNull();
    expect(ChartDocument.open(doc.text, "scxml").error).not.toBeNull();
  });

  // @tg: verifies:: [[openspec:chart-document#Text is the source of truth#External text change appears on the canvas]] {level: unit}
  it("reflects an external text change without reopening", () => {
    const doc = ChartDocument.open(fixture("order.scxml"), "scxml");
    const seen: DocumentChange[] = [];
    doc.onChange((c) => seen.push(c));
    doc.setText(doc.text.replace(`  <state id="expired"/>`, `  <state id="expired"/>\n  <state id="refunded"/>`));
    expect(doc.model!.states.has("refunded")).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.origin).toBe("external");
    expect(seen[0]!.model!.states.has("refunded")).toBe(true);
  });

  // @tg: verifies:: [[openspec:chart-document#Text is the source of truth#Visual edit changes the text]] {level: unit}
  it("writes a visual edit into the text", () => {
    for (const [text, format] of [
      [ORDER_YAML, "yaml"],
      [newChart("scxml", "o").replace(`<state id="idle"/>`, `<state id="failed"/>\n  <state id="payment"/>`).replace(`initial="idle"`, `initial="failed"`), "scxml"],
    ] as const) {
      const doc = ChartDocument.open(text, format);
      doc.apply({ type: "addTransition", source: "failed", targets: ["payment"], events: ["retry"] });
      expect(doc.text).toMatch(format === "yaml" ? /retry: payment/ : /<transition event="retry" target="payment"\/>/);
      const fresh = ChartDocument.open(doc.text, format).model!;
      expect([...fresh.transitions.values()].some((t) => t.source === "failed" && t.events[0] === "retry" && t.targets[0] === "payment")).toBe(true);
    }
  });

  // @tg: verifies:: [[openspec:chart-document#Format-preserving edits#Comments survive an edit]] {level: unit}
  it("keeps ten header comment lines when renaming cart to basket", () => {
    const doc = ChartDocument.open(ORDER_YAML, "yaml");
    doc.apply({ type: "renameState", id: "cart", newId: "basket" });
    const header = ORDER_YAML.split("\n").slice(0, 10);
    expect(header.every((l) => l.startsWith("#"))).toBe(true);
    expect(doc.text.split("\n").slice(0, 10)).toEqual(header);
    expect(diff(ORDER_YAML, doc.text)).toEqual({ removed: ["  cart:", "    on: { back: cart }"], added: ["  basket:", "    on: { back: basket }"] });
  });

  // @tg: verifies:: [[openspec:chart-document#Format-preserving edits#Untouched regions are byte-identical]] {level: unit}
  it("changes only the lines of the transition whose target moves", () => {
    const before = fixture("traffic-light.scxml");
    const doc = ChartDocument.open(before, "scxml");
    const span = doc.model!.transitions.get("green#1")!.span;
    doc.apply({ type: "updateTransition", id: "green#1", targets: ["red"] });
    const lines = before.split("\n");
    const first = doc.positionAt(span.start).line;
    const d = diff(before, doc.text);
    expect(d.removed).toEqual([lines[first - 1]]);
    expect(d.added).toEqual([`        <transition event="button" target="red"/>`]);
    const after = doc.text.split("\n");
    expect(after.length).toBe(lines.length);
    for (let i = 0; i < lines.length; i++) if (i !== first - 1) expect(after[i]).toBe(lines[i]);
  });

  // @tg: verifies:: [[openspec:chart-document#Unmodeled content is preserved#Extension survives]] {level: unit}
  it("keeps vt:decide markup byte-identical when a sibling state moves", () => {
    const before = fixture("refund.scxml");
    const doc = ChartDocument.open(before, "scxml");
    const slice = (t: string, id: string, m = ChartDocument.open(t, "scxml").model!) => t.slice(m.states.get(id)!.span.start, m.states.get(id)!.span.end);
    const review = slice(before, "review");
    const manager = slice(before, "manager");
    expect(review).toContain(`vt:decide="policy"`);
    doc.apply({ type: "setLayout", states: { approved: { x: 400, y: 10, w: 120, h: 50 } } }, { mergeKey: "drag" });
    doc.apply({ type: "reparentState", id: "rejected", parent: "approved" });
    expect(slice(doc.text, "review")).toBe(review);
    expect(slice(doc.text, "manager")).toBe(manager);
    expect(doc.text).toContain(`  <state id="review" vt:decide="policy" vt:candidates="approve reject escalate">`);
  });

  // @tg: verifies:: [[openspec:chart-document#Rename updates references#Rename a transition target]] {level: unit}
  it("renames payment to paying in both transitions that target it", () => {
    const doc = ChartDocument.open(fixture("typed-order.vt.yaml"), "yaml");
    const targeting = [...doc.model!.transitions.values()].filter((t) => t.targets.includes("payment"));
    expect(targeting.length).toBeGreaterThanOrEqual(2);
    doc.apply({ type: "renameState", id: "payment", newId: "paying" });
    const m = doc.model!;
    expect(m.states.has("payment")).toBe(false);
    expect([...m.transitions.values()].filter((t) => t.targets.includes("paying")).length).toBe(targeting.length);
    expect([...m.transitions.values()].some((t) => t.targets.includes("payment"))).toBe(false);
    expect(doc.text).not.toMatch(/\bpayment\b/);
  });

  // @tg: verifies:: [[openspec:chart-document#Undo and redo#Undo a drag]] {level: unit}
  it("undoes a whole drag in one step, byte-identically", () => {
    for (const [file, format] of [
      ["order.scxml", "scxml"],
      ["typed-order.vt.yaml", "yaml"],
    ] as const) {
      const before = fixture(file);
      const doc = ChartDocument.open(before, format);
      const id = format === "scxml" ? "paid" : "review";
      for (let x = 0; x <= 50; x += 5) doc.apply({ type: "setLayout", states: { [id]: { x, y: x / 2, w: 120, h: 60 } } }, { mergeKey: `drag:${id}` });
      expect(doc.model!.layout.get(id)).toEqual({ x: 50, y: 25, w: 120, h: 60 });
      expect(doc.undo()).toBe(true);
      expect(doc.text).toBe(before);
      expect(doc.canUndo).toBe(false);
      expect(doc.redo()).toBe(true);
      expect(doc.model!.layout.get(id)).toEqual({ x: 50, y: 25, w: 120, h: 60 });
    }
  });

  // @tg: verifies:: [[openspec:chart-document#Unparseable text is not overwritten#Broken XML]] {level: unit}
  it("reports a lost closing tag with line and column and disables editing", () => {
    const good = fixture("order.scxml");
    const doc = ChartDocument.open(good, "scxml");
    const model = doc.model;
    const broken = good.replace("  </state>\n\n  <state id=\"awaiting_payment\">", "\n  <state id=\"awaiting_payment\">");
    doc.setText(broken);
    expect(doc.error).not.toBeNull();
    expect(doc.error!.line).toBeGreaterThan(1);
    expect(doc.error!.column).toBeGreaterThan(0);
    expect(doc.positionAt(doc.error!.offset)).toEqual({ line: doc.error!.line, column: doc.error!.column });
    expect(doc.model).toBe(model);
    let err: unknown;
    try {
      doc.apply({ type: "addState", parent: null, kind: "atomic", id: "x" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EditError);
    expect((err as EditError).code).toBe("ParseError");
    expect(doc.text).toBe(broken);
    doc.setText(good);
    expect(doc.error).toBeNull();
    expect(() => doc.apply({ type: "addState", parent: null, kind: "atomic", id: "x" })).not.toThrow();
  });
});

describe("chart-layout scenarios", () => {
  // @tg: verifies:: [[openspec:chart-layout#Layout is stored inline#Positions persist across reopen]] {level: unit}
  it("draws a moved state at its moved position after reopening", () => {
    for (const [file, format] of [
      ["refund.scxml", "scxml"],
      ["typed-order.vt.yaml", "yaml"],
    ] as const) {
      const doc = ChartDocument.open(fixture(file), format);
      doc.apply({ type: "setLayout", states: { review: { x: 320, y: 140, w: 160, h: 72 } } });
      const reopened = ChartDocument.open(doc.text, format);
      expect(reopened.model!.layout.get("review")).toEqual({ x: 320, y: 140, w: 160, h: 72 });
    }
  });

  // @tg: verifies:: [[openspec:chart-layout#Stale layout is tolerated#Orphan layout entry]] {level: unit}
  it("ignores a layout entry for a missing state and drops it on the next layout write", () => {
    const text = `${ORDER_YAML}layout:
  states:
    old: { x: 1, y: 1, w: 10, h: 10 }
    cart: { x: 0, y: 0, w: 100, h: 50 }
    payment: { x: 0, y: bogus, w: 100, h: 50 }
`;
    const doc = ChartDocument.open(text, "yaml");
    expect(doc.error).toBeNull();
    expect([...doc.model!.layout.keys()]).toEqual(["cart"]);
    doc.apply({ type: "setLayout", states: { cart: { x: 5, y: 0, w: 100, h: 50 } } });
    expect(doc.text).not.toMatch(/\bold:/);
    expect(doc.text).toContain("    cart: { x: 5, y: 0, w: 100, h: 50 }\n");
    expect(doc.text).toContain("    payment: { x: 0, y: bogus, w: 100, h: 50 }\n");
  });

  it("adding a state keeps the positions of laid-out states", () => {
    const doc = ChartDocument.open(fixture("traffic-light.vt.yaml"), "yaml");
    doc.apply({ type: "setLayout", states: { red: { x: 1, y: 2, w: 3, h: 4 }, flashing: { x: 9, y: 9, w: 9, h: 9 } } });
    const layout = [...doc.model!.layout];
    doc.apply({ type: "addState", parent: "light", kind: "atomic", id: "blue" });
    expect([...doc.model!.layout]).toEqual(layout);
  });
});

describe("ChartDocument", () => {
  it("applies a batch atomically as one undo step", () => {
    const before = fixture("order.scxml");
    const doc = ChartDocument.open(before, "scxml");
    const patches = doc.apply([
      { type: "addState", parent: null, kind: "atomic", id: "refunded" },
      { type: "addTransition", source: "paid", targets: ["refunded"], events: ["refund"] },
      { type: "renameState", id: "expired", newId: "timed_out" },
    ]);
    expect(applyPatches(before, patches)).toBe(doc.text);
    expect(doc.model!.states.has("timed_out")).toBe(true);
    doc.undo();
    expect(doc.text).toBe(before);
    const t = doc.text;
    expect(() =>
      doc.apply([
        { type: "addState", parent: null, kind: "atomic", id: "ok" },
        { type: "removeState", id: "ghost" },
      ]),
    ).toThrow(EditError);
    expect(doc.text).toBe(t);
    expect(doc.model!.states.has("ok")).toBe(false);
  });

  it("merges consecutive edits with the same merge key only", () => {
    const before = fixture("typed-order.vt.yaml");
    const doc = ChartDocument.open(before, "yaml");
    doc.apply({ type: "updateData", id: "limit", expr: "6" }, { mergeKey: "limit" });
    doc.apply({ type: "updateData", id: "limit", expr: "60" }, { mergeKey: "limit" });
    doc.apply({ type: "updateData", id: "limit", expr: "600" }, { mergeKey: "limit" });
    const typed = doc.text;
    doc.apply({ type: "updateData", id: "total", expr: "1" }, { mergeKey: "total" });
    doc.undo();
    expect(doc.text).toBe(typed);
    doc.undo();
    expect(doc.text).toBe(before);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);
    doc.redo();
    expect(doc.text).toBe(typed);
    // After an undo, the same key starts a new step.
    doc.undo();
    doc.apply({ type: "updateData", id: "limit", expr: "7" }, { mergeKey: "limit" });
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.text).toBe(before);
  });

  it("notifies listeners with patches that reproduce every change", () => {
    const doc = ChartDocument.open(fixture("traffic-light.scxml"), "scxml");
    const log: { origin: string; ok: boolean }[] = [];
    let prev = doc.text;
    const off = doc.onChange((c) => {
      log.push({ origin: c.origin, ok: applyPatches(prev, c.patches) === c.text });
      prev = c.text;
    });
    doc.apply({ type: "renameState", id: "red", newId: "crimson" });
    doc.apply({ type: "removeState", id: "flashing" });
    doc.undo();
    doc.undo();
    doc.redo();
    expect(log).toEqual([
      { origin: "edit", ok: true },
      { origin: "edit", ok: true },
      { origin: "undo", ok: true },
      { origin: "undo", ok: true },
      { origin: "redo", ok: true },
    ]);
    off();
    doc.redo();
    expect(log).toHaveLength(5);
  });

  it("clears history on an external change", () => {
    const doc = ChartDocument.open(fixture("order.scxml"), "scxml");
    doc.apply({ type: "addState", parent: null, kind: "atomic", id: "x" });
    doc.setText(fixture("order.scxml"));
    expect(doc.canUndo).toBe(false);
    expect(doc.undo()).toBe(false);
  });

  it("positionAt gives 1-based lines and columns", () => {
    const doc = ChartDocument.open("vertep: 1\nname: x\nstates:\n  a: {}\n", "yaml");
    expect(doc.positionAt(0)).toEqual({ line: 1, column: 1 });
    expect(doc.positionAt(12)).toEqual({ line: 2, column: 3 });
  });

  it("reports a YAML syntax error with its position", () => {
    const doc = ChartDocument.open("vertep: 1\nname: x\nstates:\n  a: { on: [\n", "yaml");
    expect(doc.model).toBeNull();
    expect(doc.error!.line).toBeGreaterThanOrEqual(4);
  });
});

describe("helpers", () => {
  it("newChart makes one initial atomic state idle in both formats", () => {
    for (const f of ["scxml", "yaml"] as const) {
      for (const name of [undefined, "My <chart>"]) {
        const doc = ChartDocument.open(newChart(f, name), f);
        expect(doc.error).toBeNull();
        const m = doc.model!;
        expect(m.roots).toEqual(["idle"]);
        expect(m.states.get("idle")!.kind).toBe("atomic");
        expect(m.initial).toEqual(["idle"]);
        expect(m.name).toBe(name);
      }
    }
  });

  it("detectFormat recognises chart file names", () => {
    expect(detectFormat("order.scxml")).toBe("scxml");
    expect(detectFormat("dir/Order.SCXML")).toBe("scxml");
    expect(detectFormat("order.vt.yaml")).toBe("yaml");
    expect(detectFormat("order.vt.yml")).toBe("yaml");
    expect(detectFormat("order.yaml")).toBeNull();
    expect(detectFormat("order.xml")).toBeNull();
  });

  it("uniqueId avoids state and data ids", () => {
    const m = ChartDocument.open(fixture("order.scxml"), "scxml").model!;
    expect(uniqueId(m, "fresh")).toBe("fresh");
    expect(uniqueId(m, "cart")).toBe("cart_1");
    expect(uniqueId(m, "items")).toBe("items_1");
  });

  it("applyPatches applies sorted, non-overlapping patches", () => {
    expect(applyPatches("abcdef", [{ start: 4, end: 5, text: "E" }, { start: 0, end: 1, text: "A" }, { start: 2, end: 2, text: "-" }])).toBe("Ab-cdEf");
    expect(() => applyPatches("abc", [{ start: 0, end: 2, text: "" }, { start: 1, end: 3, text: "" }])).toThrow();
  });
});
