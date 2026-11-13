import { describe, expect, it } from "vitest";
import { ChartDocument, EditError, type Command } from "../src/index.js";
import { diff, fixture } from "./helpers.js";

function edit(file: string, cmd: Command | Command[]) {
  const text = file.includes("\n") ? file : fixture(file);
  const doc = ChartDocument.open(text, "yaml");
  doc.apply(cmd);
  expect(doc.error).toBeNull();
  return { doc, before: text, after: doc.text, ...diff(text, doc.text) };
}

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof EditError ? e.code : `not an EditError: ${String(e)}`;
  }
  return undefined;
}

describe("YAML commands touch only their lines", () => {
  it("addState appends to the parent's states mapping", () => {
    const r = edit("typed-order.vt.yaml", { type: "addState", parent: "shopping", kind: "atomic", id: "gift" });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(["      gift: {}"]);
    expect(r.doc.model!.states.get("shopping")!.children).toEqual(["cart", "payment", "review", "gift"]);
  });

  it("addState into a state without children creates its states mapping", () => {
    const r = edit("traffic-light.vt.yaml", { type: "addState", parent: "flashing", kind: "final", id: "off" });
    expect(r.added).toEqual(["    states:", "      off: { type: final }"]);
    const r2 = edit("typed-order.vt.yaml", { type: "addState", parent: "review", kind: "history", id: "h", historyType: "deep" });
    expect(r2.removed).toEqual([]);
    expect(r2.added).toEqual(["        states:", "          h: { type: history, history: deep }"]);
  });

  it("removeState removes the entry, emptied groups and the initial key", () => {
    const r = edit("typed-order.vt.yaml", { type: "removeState", id: "review" });
    expect(r.removed).toEqual(["            - { cond: \"ctx.total > ctx.limit\", target: review }", "      review:", "        on: { approve: fulfilment }"]);
    expect(r.added).toEqual([]);
    const r2 = edit("traffic-light.vt.yaml", { type: "removeState", id: "dont_walk" });
    expect(r2.doc.model!.states.get("crossing")!.initial).toEqual([]);
    expect(r2.removed).toContain("        initial: dont_walk");
    expect(r2.removed).toContain("            always:");
  });

  it("renameState updates the key, targets and initial keys", () => {
    const r = edit("traffic-light.vt.yaml", { type: "renameState", id: "red", newId: "crimson" });
    expect(r.removed).toEqual(["        initial: red", "          red:", "              tick: red"]);
    expect(r.added).toEqual(["        initial: crimson", "          crimson:", "              tick: crimson"]);
  });

  it("reparentState moves the entry text re-indented", () => {
    const r = edit("traffic-light.vt.yaml", { type: "reparentState", id: "flashing", parent: "operating" });
    expect(r.removed).toEqual(["  flashing:", "    on:", "      reset: operating"]);
    expect(r.added).toEqual(["      flashing:", "        on:", "          reset: operating"]);
    expect(r.doc.model!.states.get("flashing")!.parent).toBe("operating");
    const doc = ChartDocument.open(fixture("traffic-light.vt.yaml"), "yaml");
    expect(code(() => doc.apply({ type: "reparentState", id: "operating", parent: "walk" }))).toBe("Cycle");
  });

  it("setStateKind sets and removes the type key", () => {
    const r = edit("typed-order.vt.yaml", { type: "setStateKind", id: "shipped", kind: "atomic" });
    expect(r.added).toEqual(["  shipped: {}"]);
    const r2 = edit("traffic-light.vt.yaml", { type: "setStateKind", id: "light", kind: "parallel" });
    expect(r2.removed).toEqual(["        initial: red"]);
    expect(r2.added).toEqual(["        type: parallel"]);
  });

  it("setInitial writes a scalar or list and removes the key when empty", () => {
    const r = edit("typed-order.vt.yaml", { type: "setInitial", state: "shopping", initial: ["payment"] });
    expect(r.added).toEqual(["    initial: payment"]);
    const r2 = edit("typed-order.vt.yaml", { type: "setInitial", state: null, initial: [] });
    expect(r2.removed).toEqual(["initial: shopping"]);
    expect(r2.added).toEqual([]);
  });

  it("addTransition adds an on group, or turns a single transition into a list", () => {
    const r = edit("typed-order.vt.yaml", { type: "addTransition", source: "fulfilment", targets: ["cancelled"], events: ["cancel"] });
    expect(r.added).toEqual(["    on: { ship: shipped, cancel: cancelled }"]);
    const r2 = edit("traffic-light.vt.yaml", { type: "addTransition", source: "green", targets: ["red"], events: ["tick"], cond: "x" });
    expect(r2.removed).toEqual(["              tick: yellow"]);
    expect(r2.added).toEqual(["              tick:", "                - { target: yellow }", "                - { cond: x, target: red }"]);
    const r3 = edit("typed-order.vt.yaml", { type: "addTransition", source: "payment", targets: ["cart"], events: ["pay"], transitionType: "internal" });
    expect(r3.added).toEqual(["            - { target: cart, type: internal }"]);
    const r4 = edit("traffic-light.vt.yaml", { type: "addTransition", source: "walk", targets: ["walk"] });
    expect(r4.removed).toEqual(["              cond: \"In('green')\"", "              target: dont_walk"]);
    expect(r4.added).toEqual(["              - cond: \"In('green')\"", "                target: dont_walk", "              - { target: walk }"]);
  });

  it("removeTransition removes a list item or the whole group", () => {
    const r = edit("typed-order.vt.yaml", { type: "removeTransition", id: "payment#1" });
    expect(r.removed).toEqual(["            - { cond: \"ctx.total > ctx.limit\", target: review }"]);
    const r2 = edit("traffic-light.vt.yaml", { type: "removeTransition", id: "green#1" });
    expect(r2.removed).toEqual(["              button: yellow"]);
    const r3 = edit("typed-order.vt.yaml", { type: "removeTransition", id: "review#0" });
    expect(r3.removed).toEqual(["      review:", "        on: { approve: fulfilment }"]);
    expect(r3.added).toEqual(["      review: {}"]);
  });

  it("updateTransition edits in place, renames a single group key, or moves", () => {
    const r = edit("typed-order.vt.yaml", { type: "updateTransition", id: "payment#0", targets: ["review"], cond: null });
    expect(r.removed).toEqual(["            - { cond: \"ev.data.amount < ctx.total\", target: payment }"]);
    expect(r.added).toEqual(["            - { target: review }"]);
    const r2 = edit("traffic-light.vt.yaml", { type: "updateTransition", id: "green#1", events: ["press"], cond: "ok" });
    expect(r2.removed).toEqual(["              button: yellow"]);
    expect(r2.added).toEqual(["              press: { cond: ok, target: yellow }"]);
    const r3 = edit("traffic-light.vt.yaml", { type: "updateTransition", id: "flashing#0", source: "walk" });
    expect(r3.doc.model!.transitions.get("walk#1")).toMatchObject({ events: ["reset"], targets: ["operating"] });
    expect(r3.doc.model!.states.get("flashing")!.transitions).toEqual([]);
  });

  it("setContent edits only changed action items", () => {
    const doc = ChartDocument.open(fixture("typed-order.vt.yaml"), "yaml");
    const old = doc.model!.transitions.get("cart#0")!.actions;
    const t = doc.text;
    doc.apply({ type: "setContent", owner: { transition: "cart#0" }, items: [old[0]!, { kind: "raise", event: "added" }, old[1]!] });
    expect(diff(t, doc.text)).toEqual({ removed: [], added: ["                - raise: added"] });
    const r = edit("traffic-light.vt.yaml", { type: "setContent", owner: { state: "flashing", slot: "onentry" }, items: [{ kind: "log", label: "blink", expr: "1" }] });
    expect(r.added).toEqual(["    entry:", "      - log: { label: blink, expr: \"1\" }"]);
    const r2 = edit("traffic-light.vt.yaml", { type: "setContent", owner: { state: "red", slot: "onexit" }, items: [] });
    expect(r2.removed).toEqual(["            exit:", "              - cancel:", "                  sendid: light-timer"]);
    const r3 = edit("traffic-light.vt.yaml", { type: "setContent", owner: { transition: "red#0" }, items: [{ kind: "raise", event: "r" }] });
    expect(r3.removed).toEqual(["              tick: green"]);
    expect(r3.added).toEqual(["              tick:", "                target: green", "                actions:", "                  - raise: r"]);
  });

  it("addData, updateData and removeData on context entries", () => {
    const r = edit("typed-order.vt.yaml", { type: "addData", owner: null, id: "note", expr: "''", dataType: "string" });
    expect(r.added).toEqual(["  note: { type: string, init: \"''\" }"]);
    const r2 = edit("typed-order.vt.yaml", { type: "updateData", id: "limit", newId: "cap", expr: "1000", dataType: null });
    expect(r2.removed).toEqual(["  limit: { type: decimal, init: \"500\" }"]);
    expect(r2.added).toEqual(["  cap: { init: \"1000\" }"]);
    const r3 = edit("typed-order.vt.yaml", { type: "removeData", id: "total" });
    expect(r3.removed).toEqual(["  total: { type: decimal, init: \"0\" }"]);
    const r4 = edit("traffic-light.vt.yaml", { type: "addData", owner: null, id: "n", expr: "0" });
    expect(r4.added).toEqual(["context:", "  n: { init: \"0\" }"]);
  });

  it("setLayout appends a layout block with one flow entry per line, then edits entries in place", () => {
    const r = edit("traffic-light.vt.yaml", {
      type: "setLayout",
      states: { red: { x: 10, y: 20, w: 100, h: 40 }, green: { x: 10, y: 80, w: 100, h: 40, collapsed: true } },
      transitions: { "red#0": { route: [[1, 2], [3, 4]], label: [5, 6] } },
    });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual([
      "layout:",
      "  states:",
      "    red: { x: 10, y: 20, w: 100, h: 40 }",
      "    green: { x: 10, y: 80, w: 100, h: 40, collapsed: true }",
      "  transitions:",
      "    \"red#0\": { route: [[1, 2], [3, 4]], label: [5, 6] }",
    ]);
    const doc = r.doc;
    const t = doc.text;
    doc.apply({ type: "setLayout", states: { red: { x: 11, y: 20, w: 100, h: 40 }, green: null } });
    expect(diff(t, doc.text)).toEqual({
      removed: ["    red: { x: 10, y: 20, w: 100, h: 40 }", "    green: { x: 10, y: 80, w: 100, h: 40, collapsed: true }"],
      added: ["    red: { x: 11, y: 20, w: 100, h: 40 }"],
    });
  });

  it("layout keys follow renames and transition renumbering", () => {
    const t = `vertep: 1
name: l
states:
  a:
    on:
      x: b
      y: c
      z: a
  b: {}
  c: {}
layout:
  states:
    a: { x: 0, y: 0, w: 10, h: 10 }
  transitions:
    "a#1": { label: [1, 1] }
    "a#2": { label: [2, 2] }
`;
    const doc = ChartDocument.open(t, "yaml");
    doc.apply({ type: "removeTransition", id: "a#0" });
    expect([...doc.model!.transitionLayout]).toEqual([
      ["a#0", { label: [1, 1] }],
      ["a#1", { label: [2, 2] }],
    ]);
    doc.apply({ type: "renameState", id: "a", newId: "start" });
    expect([...doc.model!.layout.keys()]).toEqual(["start"]);
    expect([...doc.model!.transitionLayout.keys()]).toEqual(["start#0", "start#1"]);
    expect(doc.model!.transitionLayout.get("start#0")).toEqual({ label: [1, 1] });
    doc.apply({ type: "removeState", id: "start" });
    expect(doc.text).not.toContain("layout:");
  });

  it("setChartProps sets the name and datamodel keys", () => {
    const r = edit("typed-order.vt.yaml", { type: "setChartProps", name: "orders", datamodel: null });
    expect(r.removed).toEqual(["name: order", "datamodel: cel"]);
    expect(r.added).toEqual(["name: orders"]);
  });

  it("rejects unknown, duplicate and invalid ids without touching the text", () => {
    const doc = ChartDocument.open(fixture("typed-order.vt.yaml"), "yaml");
    const t = doc.text;
    expect(code(() => doc.apply({ type: "renameState", id: "ghost", newId: "x" }))).toBe("UnknownId");
    expect(code(() => doc.apply({ type: "addState", parent: null, kind: "atomic", id: "cart" }))).toBe("DuplicateId");
    expect(code(() => doc.apply({ type: "addState", parent: null, kind: "atomic", id: "a:b" }))).toBe("InvalidId");
    expect(code(() => doc.apply({ type: "addData", owner: null, id: "items" }))).toBe("DuplicateId");
    expect(code(() => doc.apply({ type: "addState", parent: "shipped", kind: "atomic", id: "z" }))).toBe("Unsupported");
    expect(doc.text).toBe(t);
  });
});
