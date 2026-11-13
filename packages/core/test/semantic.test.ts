import { describe, expect, it } from "vitest";
import type { ChartModel } from "../src/index.js";
import { parseScxml } from "../src/xml/semantic.js";
import { parseVtYaml } from "../src/yaml/semantic.js";
import { fixture, read, suiteFiles } from "./helpers.js";

const xml = (t: string) => parseScxml(t).model;
const yml = (t: string) => parseVtYaml(t).model;

/** A format-independent summary of a model. */
function shape(m: ChartModel) {
  return {
    name: m.name,
    datamodel: m.datamodel,
    initial: m.initial,
    roots: m.roots,
    states: [...m.states.values()].map((s) => ({
      id: s.id,
      kind: s.kind,
      parent: s.parent,
      children: s.children,
      initial: s.initial,
      transitions: s.transitions,
      onentry: s.onentry.map((b) => b.items.map((i) => ({ ...i, span: undefined }))),
      onexit: s.onexit.map((b) => b.items.map((i) => ({ ...i, span: undefined }))),
    })),
    transitions: [...m.transitions.values()].map((t) => ({ ...t, span: undefined, actions: t.actions.map((a) => ({ ...a, span: undefined })) })),
    events: m.events,
  };
}

describe("semantic view: fixtures", () => {
  it("order.scxml", () => {
    const m = xml(fixture("order.scxml"));
    expect(m.format).toBe("scxml");
    expect(m.name).toBe("order");
    expect(m.datamodel).toBe("cel");
    expect(m.initial).toEqual(["cart"]);
    expect(m.roots).toEqual(["cart", "awaiting_payment", "paid", "expired"]);
    expect([...m.states.values()].every((s) => s.kind === "atomic" && s.parent === null && !s.generatedId)).toBe(true);
    expect(m.states.get("cart")!.transitions).toEqual(["cart#0", "cart#1"]);
    const add = m.transitions.get("cart#0")!;
    expect(add).toMatchObject({ source: "cart", index: 0, events: ["add"], targets: [], type: "external" });
    expect(add.actions).toMatchObject([{ kind: "assign", location: "items", expr: "ctx.items + 1" }]);
    expect(m.transitions.get("cart#1")).toMatchObject({ events: ["checkout"], cond: "ctx.items > 0", targets: ["awaiting_payment"] });
    expect(m.states.get("awaiting_payment")!.onentry[0]!.items).toMatchObject([
      { kind: "send", sendid: "payment-timer", event: "payment.timeout", delay: "900s" },
    ]);
    expect(m.transitions.get("awaiting_payment#0")!.actions).toMatchObject([{ kind: "cancel", sendid: "payment-timer" }]);
    expect(m.data).toMatchObject([{ id: "items", expr: "0", owner: null }]);
    expect(m.events).toEqual(["add", "checkout", "pay", "payment.timeout"]);
    const t = fixture("order.scxml");
    const s = m.states.get("cart")!.span;
    expect(t.slice(s.start, s.end)).toMatch(/^<state id="cart">[\s\S]*<\/state>$/);
  });

  it("refund.scxml keeps vt: extension attributes out of the model", () => {
    const m = xml(fixture("refund.scxml"));
    expect(m.name).toBe("refund-agent");
    expect(m.states.get("review")!.transitions).toEqual(["review#0", "review#1", "review#2"]);
    expect(m.transitions.get("review#0")!.cond).toBe("ctx.amount <= 100");
    expect(m.events).toEqual(["approve", "escalate", "reject", "request"]);
  });

  it("traffic-light: SCXML and YAML give the same model", () => {
    const a = xml(fixture("traffic-light.scxml"));
    const b = yml(fixture("traffic-light.vt.yaml"));
    expect(a.states.get("operating")!.kind).toBe("parallel");
    expect(a.states.get("light")).toMatchObject({ kind: "compound", parent: "operating", children: ["red", "green", "yellow"], initial: ["red"], initialSource: "attribute" });
    expect(a.transitions.get("dont_walk#0")).toMatchObject({ events: [], cond: "In('red')", targets: ["walk"] });
    expect(shape(b)).toEqual(shape(a));
  });

  it("typed-order.vt.yaml: typed context, event catalogue and flow transitions", () => {
    const m = yml(fixture("typed-order.vt.yaml"));
    expect(m.format).toBe("yaml");
    expect(m.name).toBe("order");
    expect(m.initial).toEqual(["shopping"]);
    expect(m.states.get("shopping")).toMatchObject({ kind: "compound", children: ["cart", "payment", "review"], initial: ["cart"] });
    expect(m.states.get("shipped")!.kind).toBe("final");
    expect(m.data).toMatchObject([
      { id: "items", type: "list<Item>", expr: "[]", owner: null },
      { id: "total", type: "decimal", expr: "0" },
      { id: "limit", type: "decimal", expr: "500" },
    ]);
    expect(m.events).toEqual(["add", "approve", "cancel", "checkout", "pay", "ship"]);
    expect([...m.eventTypes]).toEqual([
      ["add", "Item"],
      ["pay", "Pay"],
      ["ship", "Ship"],
    ]);
    expect(m.states.get("payment")!.transitions).toEqual(["payment#0", "payment#1", "payment#2"]);
    expect(m.transitions.get("payment#2")).toMatchObject({ events: ["pay"], targets: ["fulfilment"] });
    expect(m.transitions.get("payment#2")!.cond).toBeUndefined();
    expect(m.transitions.get("cart#0")!.actions.map((a) => a.kind)).toEqual(["assign", "assign"]);
    expect(m.transitions.get("shopping#0")).toMatchObject({ events: ["cancel"], targets: ["cancelled"] });
  });
});

describe("semantic view: SCXML details", () => {
  it("generates vertep ids for id-less states", () => {
    const m = xml(`<scxml xmlns="http://www.w3.org/2005/07/scxml"><state><state/><state id="b"/></state><final/></scxml>`);
    expect(m.roots).toEqual(["_vt.s.0", "_vt.s.1"]);
    expect(m.states.get("_vt.s.0")!.children).toEqual(["_vt.s.0.0", "b"]);
    expect(m.states.get("_vt.s.0.0")!.generatedId).toBe(true);
    expect(m.states.get("b")!.generatedId).toBe(false);
    expect(m.states.get("_vt.s.1")!.kind).toBe("final");
  });

  it("reads <initial> elements, history states and their default transitions", () => {
    const m = xml(`<scxml xmlns="http://www.w3.org/2005/07/scxml">
  <state id="p">
    <initial><transition target="a"/></initial>
    <history id="h" type="deep"><transition target="b"/></history>
    <state id="a"/><state id="b"/>
  </state>
</scxml>`);
    expect(m.states.get("p")).toMatchObject({ initial: ["a"], initialSource: "element", children: ["h", "a", "b"], transitions: [] });
    expect(m.states.get("h")).toMatchObject({ kind: "history", historyType: "deep", transitions: ["h#0"] });
    expect(m.transitions.get("h#0")!.targets).toEqual(["b"]);
    expect(m.states.get("a")!.initialSource).toBe("implicit");
  });

  it("models executable content and keeps the rest opaque and verbatim", () => {
    const t = `<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:vt="https://w3id.org/vertep/vt#"><state id="s">
  <onentry>
    <!-- note -->
    <if cond="a"><raise event="x"/><elseif cond="b"/><log label="l" expr="1"/><else/><cancel sendidexpr="v"/></if>
    <foreach array="xs" item="x" index="i"><raise event="y"/></foreach>
    <send event="e" target="#_parent" type="t" delay="1s"><param name="p" expr="1"/></send>
    <send event="e" namelist="a b"/>
    <script>x = 1</script>
    <vt:call name="f"/>
    <assign location="l"><v/></assign>
  </onentry>
  <onentry><raise event="second"/></onentry>
</state></scxml>`;
    const m = xml(t);
    const s = m.states.get("s")!;
    expect(s.onentry.length).toBe(2);
    const items = s.onentry[0]!.items;
    expect(items.map((i) => (i.kind === "opaque" ? `opaque:${i.label}` : i.kind))).toEqual([
      "opaque:comment",
      "if",
      "foreach",
      "send",
      "opaque:send",
      "opaque:script",
      "opaque:vt:call",
      "opaque:assign",
    ]);
    expect(items[1]).toMatchObject({
      kind: "if",
      branches: [
        { cond: "a", actions: [{ kind: "raise", event: "x" }] },
        { cond: "b", actions: [{ kind: "log", label: "l", expr: "1" }] },
        { actions: [{ kind: "cancel", sendidexpr: "v" }] },
      ],
    });
    expect(items[2]).toMatchObject({ kind: "foreach", array: "xs", item: "x", index: "i", actions: [{ kind: "raise", event: "y" }] });
    expect(items[3]).toMatchObject({ kind: "send", event: "e", target: "#_parent", type: "t", delay: "1s", params: [{ name: "p", expr: "1" }] });
    for (const i of items) if (i.kind === "opaque") expect(t.slice(i.span.start, i.span.end)).toBe(i.source);
    expect(items[5]).toMatchObject({ source: "<script>x = 1</script>" });
  });

  it("reads vl: layout attributes; malformed entries are ignored", () => {
    const m = xml(`<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:L="https://w3id.org/vertep/layout#">
  <state id="a" L:x="10" L:y="20.5" L:w="100" L:h="50" L:collapsed="true"><transition target="b" L:route="1,2 3,4" L:label="5,6"/></state>
  <state id="b" L:x="oops" L:y="1" L:w="1" L:h="1"><transition target="a" L:route="1;2"/></state>
  <state id="c" vl:x="1" xmlns:vl="urn:other"/>
</scxml>`);
    expect(m.layout.get("a")).toEqual({ x: 10, y: 20.5, w: 100, h: 50, collapsed: true });
    expect(m.layout.has("b")).toBe(false);
    expect(m.layout.has("c")).toBe(false);
    expect(m.transitionLayout.get("a#0")).toEqual({ route: [[1, 2], [3, 4]], label: [5, 6] });
    expect(m.transitionLayout.has("b#0")).toBe(false);
  });

  const suite = suiteFiles(".txml", ".scxml");
  it.skipIf(suite.length === 0)("builds a model of every W3C suite document", () => {
    for (const f of suite) {
      const m = xml(read(f));
      expect(m.roots.length, f).toBeGreaterThan(0);
      for (const t of m.transitions.values()) expect(m.states.get(t.source)!.transitions).toContain(t.id);
    }
  });
});

describe("semantic view: YAML details", () => {
  it("reads every transition spelling in document order", () => {
    const m = yml(`vertep: 1
name: t
states:
  a:
    on:
      go: b
      multi: [b, c]
      guarded: { cond: "x > 1", target: c, type: internal }
      several:
        - b
        - { cond: "y", target: c }
        -
      "two words": b
    always: c
    transitions:
      - { event: "e f", target: b }
      - { target: c }
  b: {}
  c:
`);
    const ts = [...m.transitions.values()].map((t) => [t.id, t.events, t.targets, t.cond, t.type]);
    expect(ts).toEqual([
      ["a#0", ["go"], ["b"], undefined, "external"],
      ["a#1", ["multi"], ["b", "c"], undefined, "external"],
      ["a#2", ["guarded"], ["c"], "x > 1", "internal"],
      ["a#3", ["several"], ["b"], undefined, "external"],
      ["a#4", ["several"], ["c"], "y", "external"],
      ["a#5", ["several"], [], undefined, "external"],
      ["a#6", ["two", "words"], ["b"], undefined, "external"],
      ["a#7", [], ["c"], undefined, "external"],
      ["a#8", ["e", "f"], ["b"], undefined, "external"],
      ["a#9", [], ["c"], undefined, "external"],
    ]);
    expect(m.events).toEqual(["e", "f", "go", "guarded", "multi", "several", "two", "words"]);
    expect(m.states.get("c")!.kind).toBe("atomic");
  });

  it("reads kinds, initial elements, generated ids, blocks and content", () => {
    const t = `vertep: 1
name: k
initial: [p]
states:
  p:
    initial_element: { transition: { target: a } }
    context:
      n: { type: int, init: "1" }
    entry:
      - [ { raise: one } ]
      - [ { raise: two } ]
    exit:
      - if:
          - cond: "a"
            do: [ { raise: x } ]
          - do: [ { log: { expr: "1" } } ]
      - foreach: { array: xs, item: x, do: [ { raise: y } ] }
      - send: { event: e, id: s1, delay: "1s", params: { p: "1" } }
      - script: "x = 1"
      - call: f
      - assign: { location: l, content: "<v/>" }
    states:
      a: { generated: true }
      h: { type: history, history: deep, always: a }
      par: { type: parallel }
`;
    const m = yml(t);
    expect(m.initial).toEqual(["p"]);
    const p = m.states.get("p")!;
    expect(p).toMatchObject({ kind: "compound", initial: ["a"], initialSource: "element", children: ["a", "h", "par"] });
    expect(p.onentry.map((b) => b.items.map((i) => (i as { event: string }).event))).toEqual([["one"], ["two"]]);
    expect(p.onexit[0]!.items.map((i) => (i.kind === "opaque" ? `opaque:${i.label}` : i.kind))).toEqual([
      "if",
      "foreach",
      "send",
      "opaque:script",
      "opaque:call",
      "opaque:assign",
    ]);
    expect(p.onexit[0]!.items[0]).toMatchObject({ branches: [{ cond: "a", actions: [{ kind: "raise", event: "x" }] }, { actions: [{ kind: "log", expr: "1" }] }] });
    expect(p.onexit[0]!.items[2]).toMatchObject({ kind: "send", event: "e", sendid: "s1", delay: "1s", params: [{ name: "p", expr: "1" }] });
    expect(m.states.get("a")!.generatedId).toBe(true);
    expect(m.states.get("h")).toMatchObject({ kind: "history", historyType: "deep", transitions: ["h#0"] });
    expect(m.states.get("par")!.kind).toBe("parallel");
    expect(m.data).toMatchObject([{ id: "n", type: "int", expr: "1", owner: "p" }]);
    for (const i of p.onexit[0]!.items) if (i.kind === "opaque") expect(t.slice(i.span.start, i.span.end)).toBe(i.source);
  });

  it("reads the layout block; malformed and orphan entries are ignored", () => {
    const m = yml(`vertep: 1
name: l
states:
  a: { on: { go: b } }
  b: {}
layout:
  states:
    a: { x: 1, y: 2, w: 30, h: 40, collapsed: true }
    b: { x: 1, y: nope, w: 30, h: 40 }
    old: { x: 0, y: 0, w: 1, h: 1 }
  transitions:
    "a#0": { route: [[1, 2], [3, 4]], label: [5, 6] }
    "a#7": { label: [1, 1] }
`);
    expect([...m.layout]).toEqual([["a", { x: 1, y: 2, w: 30, h: 40, collapsed: true }]]);
    expect([...m.transitionLayout]).toEqual([["a#0", { route: [[1, 2], [3, 4]], label: [5, 6] }]]);
  });
});
