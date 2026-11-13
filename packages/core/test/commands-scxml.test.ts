import { describe, expect, it } from "vitest";
import { ChartDocument, EditError, type Command } from "../src/index.js";
import { diff, fixture } from "./helpers.js";

function edit(file: string, cmd: Command | Command[]) {
  const doc = ChartDocument.open(fixture(file), "scxml");
  const before = doc.text;
  doc.apply(cmd);
  expect(doc.error).toBeNull();
  return { doc, before, after: doc.text, ...diff(before, doc.text) };
}

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof EditError ? e.code : `not an EditError: ${String(e)}`;
  }
  return undefined;
}

describe("SCXML commands touch only their lines", () => {
  it("addState appends a sibling with the siblings' indentation", () => {
    const r = edit("order.scxml", { type: "addState", parent: null, kind: "atomic", id: "refunded" });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(["  <state id=\"refunded\"/>"]);
    expect(r.doc.model!.roots.at(-1)).toBe("refunded");
  });

  it("addState into a self-closing state opens it", () => {
    const r = edit("order.scxml", { type: "addState", parent: "paid", kind: "final", id: "done" });
    expect(r.removed).toEqual(["  <state id=\"paid\"/>"]);
    expect(r.added).toEqual(["  <state id=\"paid\">", "    <final id=\"done\"/>", "  </state>"]);
  });

  it("addState with layout writes vl: attributes and declares the namespace once", () => {
    const r = edit("traffic-light.scxml", { type: "addState", parent: "light", kind: "atomic", id: "blue", layout: { x: 1, y: 2.5, w: 30, h: 40 } });
    expect(r.removed).toEqual(["       name=\"traffic-light\" initial=\"operating\">"]);
    expect(r.added).toEqual([
      "       name=\"traffic-light\" initial=\"operating\" xmlns:vl=\"https://w3id.org/vertep/layout#\">",
      "      <state id=\"blue\" vl:x=\"1\" vl:y=\"2.5\" vl:w=\"30\" vl:h=\"40\"/>",
    ]);
    expect(r.doc.model!.layout.get("blue")).toEqual({ x: 1, y: 2.5, w: 30, h: 40 });
  });

  it("removeState removes the subtree and every transition targeting it", () => {
    const r = edit("traffic-light.scxml", { type: "removeState", id: "light" });
    const m = r.doc.model!;
    expect(m.states.has("light")).toBe(false);
    expect(m.states.has("red")).toBe(false);
    expect(m.states.get("operating")!.children).toEqual(["crossing"]);
    expect(r.added).toEqual([]);
    expect(r.removed[0]).toBe("    <state id=\"light\" initial=\"red\">");
    expect(r.removed.at(-1)).toBe("    </state>");
  });

  it("removeState drops only the removed target of a multi-target transition", () => {
    const t = `<scxml xmlns="http://www.w3.org/2005/07/scxml">
  <parallel id="p"><state id="a"/><state id="b"/></parallel>
  <state id="s">
    <transition event="go" target="a b"/>
    <transition event="only" target="b"/>
  </state>
</scxml>`;
    const doc = ChartDocument.open(t, "scxml");
    doc.apply({ type: "removeState", id: "b" });
    const d = diff(t, doc.text);
    expect(d.removed).toEqual(["  <parallel id=\"p\"><state id=\"a\"/><state id=\"b\"/></parallel>", "    <transition event=\"go\" target=\"a b\"/>", "    <transition event=\"only\" target=\"b\"/>"]);
    expect(d.added).toEqual(["  <parallel id=\"p\"><state id=\"a\"/></parallel>", "    <transition event=\"go\" target=\"a\"/>"]);
  });

  it("removeState of an initial target clears the initial attribute", () => {
    const r = edit("order.scxml", { type: "removeState", id: "cart" });
    expect(r.doc.model!.initial).toEqual([]);
    expect(r.added).toEqual(["       name=\"order\">"]);
  });

  it("renameState updates the id, targets and initial attributes", () => {
    const r = edit("traffic-light.scxml", { type: "renameState", id: "red", newId: "crimson" });
    expect(r.removed).toEqual(["    <state id=\"light\" initial=\"red\">", "      <state id=\"red\">", "        <transition event=\"tick\" target=\"red\"/>"]);
    expect(r.added).toEqual(["    <state id=\"light\" initial=\"crimson\">", "      <state id=\"crimson\">", "        <transition event=\"tick\" target=\"crimson\"/>"]);
  });

  it("renameState updates <initial> elements and history default transitions", () => {
    const t = `<scxml xmlns="http://www.w3.org/2005/07/scxml">
  <state id="p">
    <initial><transition target="a"/></initial>
    <history id="h"><transition target="a"/></history>
    <state id="a"/>
  </state>
</scxml>`;
    const doc = ChartDocument.open(t, "scxml");
    doc.apply({ type: "renameState", id: "a", newId: "z" });
    expect(doc.text).toBe(t.replace(/"a"/g, '"z"'));
    expect(doc.model!.states.get("p")!.initial).toEqual(["z"]);
  });

  it("reparentState moves the element with re-indentation and refuses cycles", () => {
    const r = edit("order.scxml", { type: "reparentState", id: "expired", parent: "paid" });
    expect(r.removed).toEqual(["  <state id=\"paid\"/>", "  <state id=\"expired\"/>"]);
    expect(r.added).toEqual(["  <state id=\"paid\">", "    <state id=\"expired\"/>", "  </state>"]);
    const doc = ChartDocument.open(fixture("traffic-light.scxml"), "scxml");
    expect(code(() => doc.apply({ type: "reparentState", id: "operating", parent: "red" }))).toBe("Cycle");
    expect(code(() => doc.apply({ type: "reparentState", id: "light", parent: "light" }))).toBe("Cycle");
  });

  it("reparentState to an index among siblings", () => {
    const r = edit("traffic-light.scxml", { type: "reparentState", id: "flashing", parent: "light", index: 1 });
    expect(r.doc.model!.states.get("light")!.children).toEqual(["red", "flashing", "green", "yellow"]);
    expect(r.added).toEqual(["      <state id=\"flashing\">", "        <transition event=\"reset\" target=\"operating\"/>", "      </state>"]);
  });

  it("setStateKind renames the element tag", () => {
    const r = edit("order.scxml", { type: "setStateKind", id: "paid", kind: "final" });
    expect(r.removed).toEqual(["  <state id=\"paid\"/>"]);
    expect(r.added).toEqual(["  <final id=\"paid\"/>"]);
    const r2 = edit("traffic-light.scxml", { type: "setStateKind", id: "light", kind: "parallel" });
    expect(r2.added).toEqual(["    <parallel id=\"light\">", "    </parallel>"]);
  });

  it("setInitial sets and clears the initial attribute", () => {
    const r = edit("traffic-light.scxml", { type: "setInitial", state: "light", initial: ["yellow"] });
    expect(r.added).toEqual(["    <state id=\"light\" initial=\"yellow\">"]);
    const r2 = edit("traffic-light.scxml", { type: "setInitial", state: "light", initial: [] });
    expect(r2.added).toEqual(["    <state id=\"light\">"]);
  });

  it("addTransition inserts after the source's last transition", () => {
    const r = edit("order.scxml", { type: "addTransition", source: "awaiting_payment", targets: ["cart"], events: ["retry"], cond: "a < b" });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(["    <transition event=\"retry\" cond=\"a &lt; b\" target=\"cart\"/>"]);
    expect(r.doc.model!.transitions.get("awaiting_payment#2")).toMatchObject({ events: ["retry"], cond: "a < b", targets: ["cart"] });
  });

  it("removeTransition removes its line only", () => {
    const r = edit("traffic-light.scxml", { type: "removeTransition", id: "green#1" });
    expect(r.removed).toEqual(["        <transition event=\"button\" target=\"yellow\"/>"]);
    expect(r.added).toEqual([]);
  });

  it("updateTransition changes attributes in place and can move to another source", () => {
    const r = edit("refund.scxml", { type: "updateTransition", id: "review#2", targets: ["rejected"], cond: null, events: ["escalate", "bump"], transitionType: "internal" });
    expect(r.removed).toEqual(["    <transition event=\"escalate\" cond=\"ctx.amount > 100\" target=\"manager\"/>"]);
    expect(r.added).toEqual(["    <transition event=\"escalate bump\" target=\"rejected\" type=\"internal\"/>"]);
    const r2 = edit("order.scxml", { type: "updateTransition", id: "cart#1", source: "paid" });
    expect(r2.removed).toEqual(["    <transition event=\"checkout\" cond=\"ctx.items > 0\" target=\"awaiting_payment\"/>", "  <state id=\"paid\"/>"]);
    expect(r2.added).toEqual(["  <state id=\"paid\">", "    <transition event=\"checkout\" cond=\"ctx.items > 0\" target=\"awaiting_payment\"/>", "  </state>"]);
  });

  it("setContent rewrites only changed items and keeps opaque items verbatim", () => {
    const t = `<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:vt="https://w3id.org/vertep/vt#">
  <state id="s">
    <onentry>
      <raise event="a"/>
      <script>  odd   spacing </script>
      <vt:call name="f"/>
    </onentry>
  </state>
</scxml>`;
    const doc = ChartDocument.open(t, "scxml");
    const items = doc.model!.states.get("s")!.onentry[0]!.items;
    doc.apply({ type: "setContent", owner: { state: "s", slot: "onentry" }, items: [items[0]!, { kind: "log", expr: "1" }, items[1]!, items[2]!] });
    expect(diff(t, doc.text)).toEqual({ removed: [], added: ["      <log expr=\"1\"/>"] });
    const d2 = doc.text;
    doc.apply({ type: "setContent", owner: { state: "s", slot: "onentry" }, items: [items[2]!, { kind: "raise", event: "b" }] });
    expect(doc.text).toContain(`<onentry>\n      <vt:call name="f"/>\n      <raise event="b"/>\n    </onentry>`);
    expect(diff(d2, doc.text)).toEqual({
      removed: ["      <raise event=\"a\"/>", "      <log expr=\"1\"/>", "      <script>  odd   spacing </script>"],
      added: ["      <raise event=\"b\"/>"],
    });
  });

  it("setContent keeps inline blocks inline and creates new blocks", () => {
    const r = edit("traffic-light.scxml", { type: "setContent", owner: { state: "red", slot: "onentry" }, items: [{ kind: "send", sendid: "light-timer", event: "tick", delay: "35s" }] });
    expect(r.removed).toEqual(["        <onentry><send id=\"light-timer\" event=\"tick\" delay=\"30s\"/></onentry>"]);
    expect(r.added).toEqual(["        <onentry><send id=\"light-timer\" event=\"tick\" delay=\"35s\"/></onentry>"]);
    const r2 = edit("order.scxml", { type: "setContent", owner: { state: "cart", slot: "onexit" }, items: [{ kind: "log", label: "bye" }] });
    expect(r2.added).toEqual(["    <onexit><log label=\"bye\"/></onexit>"]);
    const r3 = edit("order.scxml", { type: "setContent", owner: { transition: "cart#1" }, items: [{ kind: "raise", event: "checked" }] });
    expect(r3.added).toEqual(["    <transition event=\"checkout\" cond=\"ctx.items > 0\" target=\"awaiting_payment\"><raise event=\"checked\"/></transition>"]);
    const r4 = edit("order.scxml", { type: "setContent", owner: { state: "awaiting_payment", slot: "onentry" }, items: [] });
    expect(r4.removed).toEqual(["    <onentry><send id=\"payment-timer\" event=\"payment.timeout\" delay=\"900s\"/></onentry>"]);
    expect(r4.added).toEqual([]);
  });

  it("addData, updateData and removeData", () => {
    const r = edit("order.scxml", { type: "addData", owner: null, id: "total", expr: "0" });
    expect(r.added).toEqual(["    <data id=\"total\" expr=\"0\"/>"]);
    const r2 = edit("order.scxml", { type: "updateData", id: "items", newId: "count", expr: "1" });
    expect(r2.added).toEqual(["    <data id=\"count\" expr=\"1\"/>"]);
    const r3 = edit("order.scxml", { type: "removeData", id: "items" });
    expect(r3.removed).toEqual(["  <datamodel>", "    <data id=\"items\" expr=\"0\"/>", "  </datamodel>"]);
    const r4 = edit("traffic-light.scxml", { type: "addData", owner: "red", id: "n", expr: "0" });
    expect(r4.added).toEqual(["        <datamodel>", "          <data id=\"n\" expr=\"0\"/>", "        </datamodel>"]);
    const doc = ChartDocument.open(fixture("order.scxml"), "scxml");
    expect(code(() => doc.apply({ type: "addData", owner: null, id: "x", dataType: "int" }))).toBe("Unsupported");
  });

  it("setLayout writes, updates and removes vl: attributes", () => {
    const r = edit("refund.scxml", {
      type: "setLayout",
      states: { review: { x: 10, y: 20, w: 120, h: 60, collapsed: true } },
      transitions: { "idle#0": { route: [[1, 2], [3.25, 4]], label: [5, 6] } },
    });
    expect(r.removed).toEqual([
      "       version=\"1.0\" datamodel=\"cel\" name=\"refund-agent\" initial=\"idle\">",
      "    <transition event=\"request\" target=\"review\">",
      "  <state id=\"review\" vt:decide=\"policy\" vt:candidates=\"approve reject escalate\">",
    ]);
    expect(r.added).toEqual([
      "       version=\"1.0\" datamodel=\"cel\" name=\"refund-agent\" initial=\"idle\" xmlns:vl=\"https://w3id.org/vertep/layout#\">",
      "    <transition event=\"request\" target=\"review\" vl:route=\"1,2 3.25,4\" vl:label=\"5,6\">",
      "  <state id=\"review\" vt:decide=\"policy\" vt:candidates=\"approve reject escalate\" vl:x=\"10\" vl:y=\"20\" vl:w=\"120\" vl:h=\"60\" vl:collapsed=\"true\">",
    ]);
    const doc = r.doc;
    const t1 = doc.text;
    doc.apply({ type: "setLayout", states: { review: { x: 11, y: 20, w: 120, h: 60 } } });
    expect(diff(t1, doc.text).added).toEqual(["  <state id=\"review\" vt:decide=\"policy\" vt:candidates=\"approve reject escalate\" vl:x=\"11\" vl:y=\"20\" vl:w=\"120\" vl:h=\"60\">"]);
    doc.apply({ type: "setLayout", states: { review: null }, transitions: { "idle#0": null } });
    expect(diff(fixture("refund.scxml"), doc.text).added).toEqual([
      "       version=\"1.0\" datamodel=\"cel\" name=\"refund-agent\" initial=\"idle\" xmlns:vl=\"https://w3id.org/vertep/layout#\">",
    ]);
  });

  it("setChartProps sets and removes root attributes", () => {
    const r = edit("order.scxml", { type: "setChartProps", name: "orders", datamodel: null });
    expect(r.removed).toEqual(["<scxml xmlns=\"http://www.w3.org/2005/07/scxml\" version=\"1.0\" datamodel=\"cel\"", "       name=\"order\" initial=\"cart\">"]);
    expect(r.added).toEqual(["<scxml xmlns=\"http://www.w3.org/2005/07/scxml\" version=\"1.0\"", "       name=\"orders\" initial=\"cart\">"]);
  });

  it("rejects unknown, duplicate and invalid ids without touching the text", () => {
    const doc = ChartDocument.open(fixture("order.scxml"), "scxml");
    const t = doc.text;
    expect(code(() => doc.apply({ type: "removeState", id: "nope" }))).toBe("UnknownId");
    expect(code(() => doc.apply({ type: "renameState", id: "cart", newId: "paid" }))).toBe("DuplicateId");
    expect(code(() => doc.apply({ type: "addState", parent: null, kind: "atomic", id: "bad id" }))).toBe("InvalidId");
    expect(code(() => doc.apply({ type: "addTransition", source: "cart", targets: ["ghost"] }))).toBe("UnknownId");
    expect(code(() => doc.apply({ type: "removeTransition", id: "cart#9" }))).toBe("UnknownId");
    expect(code(() => doc.apply({ type: "setInitial", state: "cart", initial: ["paid"] }))).toBe("Unsupported");
    expect(doc.text).toBe(t);
    expect(doc.canUndo).toBe(false);
  });
});
