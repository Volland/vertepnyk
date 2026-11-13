import { afterEach, describe, expect, it } from "vitest";
import { ChartDocument, type Span } from "@vertepnyk/core";
import { PAYMENT_SCXML, PAYMENT_YAML, byAria, byLabel, choose, mount, open, tick, type as typeInto } from "./helpers.js";

let mounted: { dispose(): void } | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});
const show = (...a: Parameters<typeof mount>) => (mounted = mount(...a));

describe("Inspect the selection", () => {
  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("sets a transition to internal in SCXML", () => {
    const doc = open("order.scxml");
    const m = show(doc, ["awaiting_payment#1"]);
    choose(byLabel(m.root, "Type") as HTMLSelectElement, "internal");
    expect(doc.text).toContain('type="internal"');
    expect(doc.model!.transitions.get("awaiting_payment#1")!.type).toBe("internal");
  });

  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("sets a transition to internal in YAML", () => {
    const doc = ChartDocument.open(PAYMENT_YAML, "yaml");
    const m = show(doc, ["payment#0"]);
    choose(byLabel(m.root, "Type") as HTMLSelectElement, "internal");
    expect(doc.text).toContain("type: internal");
  });

  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("edits the guard, keeps focus on the field while typing, and merges typing into one undo step", () => {
    const doc = ChartDocument.open(PAYMENT_SCXML, "scxml");
    const m = show(doc, ["payment#0"]);
    const guard = byLabel(m.root, "Guard") as HTMLInputElement;
    guard.focus();
    typeInto(guard, "a");
    typeInto(guard, "ab");
    typeInto(guard, "abc");
    expect(byLabel(m.root, "Guard")).toBe(guard);
    expect(guard.isConnected).toBe(true);
    expect(doc.model!.transitions.get("payment#0")!.cond).toBe("abc");
    doc.undo();
    expect(doc.model!.transitions.get("payment#0")!.cond).toBeUndefined();
  });

  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("edits targets and source of a transition and renames a state", () => {
    const doc = ChartDocument.open(PAYMENT_SCXML, "scxml");
    const sel: string[][] = [];
    const m = show(doc, ["payment#0"], { onSelect: (s) => sel.push([...s]) });
    byAria(m.root, "Remove target done").click();
    expect(doc.model!.transitions.get("payment#0")!.targets).toEqual([]);
    choose(byAria(m.root, "Add target") as HTMLSelectElement, "payment");
    expect(doc.model!.transitions.get("payment#0")!.targets).toEqual(["payment"]);
    m.dispose();
    const m2 = show(doc, ["payment"], { onSelect: (s) => sel.push([...s]) });
    typeInto(byLabel(m2.root, "Id") as HTMLInputElement, "checkout", "change");
    expect(doc.model!.states.has("checkout")).toBe(true);
    expect(sel.at(-1)).toEqual(["checkout"]);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("shows kind, initial child, history type and a multi-selection summary", () => {
    const doc = open("traffic-light.scxml");
    const m = show(doc, ["light"]);
    expect((byLabel(m.root, "Kind") as HTMLSelectElement).value).toBe("compound");
    expect((byLabel(m.root, "Initial child") as HTMLSelectElement).value).toBe("red");
    choose(byLabel(m.root, "Initial child") as HTMLSelectElement, "green");
    expect(doc.model!.states.get("light")!.initial).toEqual(["green"]);
    m.dispose();
    const m2 = show(doc, ["light", "red"]);
    expect(m2.root.textContent).toContain("2 items selected");
  });
});

describe("Edit the datamodel", () => {
  // @tg: verifies:: [[openspec:chart-inspector#Edit the datamodel#Add a data item]] {level: unit}
  it("adds a data item in SCXML", () => {
    const doc = ChartDocument.open(PAYMENT_SCXML.replace('<datamodel><data id="attempts" expr="0"/></datamodel>', ""), "scxml");
    const m = show(doc, []);
    typeInto(byLabel(m.root, "New data id") as HTMLInputElement, "attempts");
    typeInto(byLabel(m.root, "New initial expression") as HTMLInputElement, "0");
    [...m.root.querySelectorAll("button")].find((b) => b.textContent === "Add data")!.click();
    expect(doc.model!.data.find((d) => d.id === "attempts")?.expr).toBe("0");
    expect(doc.text).toContain('<data id="attempts" expr="0"');
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit the datamodel#Add a data item]] {level: unit}
  it("adds, edits and removes a data item in YAML, with a type field on typed CEL charts", () => {
    const doc = open("typed-order.vt.yaml");
    const m = show(doc, []);
    typeInto(byLabel(m.root, "New data id") as HTMLInputElement, "attempts");
    typeInto(byLabel(m.root, "New initial expression") as HTMLInputElement, "0");
    typeInto(byLabel(m.root, "New data type") as HTMLInputElement, "int");
    [...m.root.querySelectorAll("button")].find((b) => b.textContent === "Add data")!.click();
    const d = doc.model!.data.find((x) => x.id === "attempts")!;
    expect(d.expr).toBe("0");
    expect(d.type).toBe("int");
    const idx = doc.model!.data.findIndex((x) => x.id === "attempts");
    typeInto(byLabel(m.root, "Initial expression", idx) as HTMLInputElement, "1");
    expect(doc.model!.data.find((x) => x.id === "attempts")!.expr).toBe("1");
    byAria(m.root, "Remove data attempts").click();
    expect(doc.model!.data.some((x) => x.id === "attempts")).toBe(false);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit the datamodel#Add a data item]] {level: unit}
  it("hides the type field on untyped charts and edits the datamodel kind and name", () => {
    const doc = ChartDocument.open(PAYMENT_SCXML, "scxml");
    const m = show(doc, []);
    expect(m.root.textContent).not.toContain("New data type");
    choose(byLabel(m.root, "Datamodel") as HTMLSelectElement, "cel");
    expect(doc.model!.datamodel).toBe("cel");
    typeInto(byLabel(m.root, "Name") as HTMLInputElement, "shop");
    expect(doc.model!.name).toBe("shop");
  });
});

describe("Edit executable content", () => {
  const addAssign = (doc: ChartDocument) => {
    const m = show(doc, ["payment"]);
    choose(byAria(m.root, "Add item to On entry") as HTMLSelectElement, "assign");
    const entry = byAria(m.root, "On entry");
    typeInto(byLabel(entry, "Location") as HTMLInputElement, "attempts");
    typeInto(byLabel(entry, "Expression") as HTMLInputElement, "attempts + 1");
    return m;
  };

  // @tg: verifies:: [[openspec:chart-inspector#Edit executable content#Add an assign on entry]] {level: unit}
  it("adds an assign on entry in SCXML", () => {
    const doc = ChartDocument.open(PAYMENT_SCXML, "scxml");
    addAssign(doc);
    const entry = doc.model!.states.get("payment")!.onentry.flatMap((b) => b.items);
    expect(entry).toMatchObject([{ kind: "assign", location: "attempts", expr: "attempts + 1" }]);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit executable content#Add an assign on entry]] {level: unit}
  it("adds an assign on entry in YAML", () => {
    const doc = ChartDocument.open(PAYMENT_YAML, "yaml");
    addAssign(doc);
    const entry = doc.model!.states.get("payment")!.onentry.flatMap((b) => b.items);
    expect(entry).toMatchObject([{ kind: "assign", location: "attempts", expr: "attempts + 1" }]);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit executable content#Add an assign on entry]] {level: unit}
  it("adds every kind, edits nested if/foreach content, reorders and removes (SCXML and YAML)", () => {
    for (const [text, format] of [[PAYMENT_SCXML, "scxml"], [PAYMENT_YAML, "yaml"]] as const) {
      const doc = ChartDocument.open(text, format);
      const m = show(doc, ["payment"]);
      for (const k of ["raise", "send", "log", "cancel", "if", "foreach"]) choose(byAria(m.root, "Add item to On entry") as HTMLSelectElement, k);
      const kinds = () => doc.model!.states.get("payment")!.onentry.flatMap((b) => b.items).map((i) => i.kind);
      expect(kinds()).toEqual(["raise", "send", "log", "cancel", "if", "foreach"]);
      // nested: add a raise to the if's "Then" list and an else branch
      const ifItem = m.root.querySelector<HTMLElement>('[data-kind="if"]')!;
      choose(byAria(ifItem, "Add item to Then") as HTMLSelectElement, "raise");
      [...ifItem.querySelectorAll("button")].find((b) => b.textContent === "Add else")!.click();
      const got = doc.model!.states.get("payment")!.onentry.flatMap((b) => b.items).find((i) => i.kind === "if")!;
      expect(got.kind === "if" && got.branches.map((b) => b.cond === undefined)).toEqual([false, true]);
      // reorder + remove
      byAria(m.root, "Move raise down").click();
      expect(kinds()[0]).toBe("send");
      byAria(m.root, "Remove cancel").click();
      expect(kinds()).not.toContain("cancel");
    }
  });
});

describe("Expression fields are checked", () => {
  // @tg: verifies:: [[openspec:chart-inspector#Expression fields are checked#CEL type error at the field]] {level: unit}
  it("shows a type error under the guard field without blocking the edit", async () => {
    const doc = open("typed-order.vt.yaml");
    const calls: string[] = [];
    const m = show(doc, ["cart#0"], {
      checkExpression: async (req) => {
        calls.push(`${req.kind}:${req.text}`);
        return req.text.includes('"100"') ? { message: "type error: cannot compare decimal with string" } : null;
      },
    });
    const guard = byLabel(m.root, "Guard") as HTMLInputElement;
    typeInto(guard, 'ctx.total > "100"');
    await tick(30);
    const err = m.root.querySelector('[role="alert"]')!;
    expect(err.textContent).toContain("type error");
    expect(guard.getAttribute("aria-invalid")).toBe("true");
    expect(guard.getAttribute("aria-describedby")).toBe(err.id);
    expect(doc.model!.transitions.get("cart#0")!.cond).toBe('ctx.total > "100"');
    expect(calls).toContain('guard:ctx.total > "100"');
    typeInto(guard, "ctx.total > 100");
    await tick(30);
    expect(m.root.querySelector('[role="alert"]')).toBeNull();
    expect(guard.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Unmodeled content is shown read-only", () => {
  const SCRIPT = "<script>  var   x = 1;  </script>";
  const chart = `<?xml version="1.0"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="s">
  <state id="s">
    <onentry>
      ${SCRIPT}
    </onentry>
  </state>
</scxml>
`;

  // @tg: verifies:: [[openspec:chart-inspector#Unmodeled content is shown read-only#Script block stays intact]] {level: unit}
  it("keeps a script byte-identical after adding a log after it, and reveals it in text", () => {
    const doc = ChartDocument.open(chart, "scxml");
    const spans: Span[] = [];
    const m = show(doc, ["s"], { onRevealText: (s) => spans.push(s) });
    const entry = byAria(m.root, "On entry");
    expect(entry.textContent).toContain("var   x = 1;");
    [...entry.querySelectorAll("button")].find((b) => b.textContent === "Show in text")!.click();
    expect(spans).toHaveLength(1);
    expect(chart.slice(spans[0]!.start, spans[0]!.end)).toBe(SCRIPT);
    choose(byAria(m.root, "Add item to On entry") as HTMLSelectElement, "log");
    expect(doc.text).toContain(SCRIPT);
    const items = doc.model!.states.get("s")!.onentry.flatMap((b) => b.items);
    expect(items.map((i) => i.kind)).toEqual(["opaque", "log"]);
    typeInto(byLabel(byAria(m.root, "On entry"), "Expression") as HTMLInputElement, "'hi'");
    expect(doc.text).toContain(SCRIPT);
    expect(doc.text).toContain("<log");
  });

  // @tg: verifies:: [[openspec:chart-inspector#Unmodeled content is shown read-only#Script block stays intact]] {level: unit}
  it("keeps a foreign extension element in a YAML-less chart intact when removing a sibling", () => {
    const doc = ChartDocument.open(chart.replace("</onentry>", '<log expr="1"/></onentry>'), "scxml");
    const m = show(doc, ["s"]);
    byAria(m.root, "Remove log").click();
    expect(doc.text).toContain(SCRIPT);
    expect(doc.text).not.toContain("<log");
  });
});

describe("Event catalogue", () => {
  // @tg: verifies:: [[openspec:chart-inspector#Event catalogue#Suggest a known event]] {level: unit}
  it("offers pay for pa in SCXML and accepts a new name", () => {
    const doc = open("order.scxml");
    const m = show(doc, ["cart#0"]);
    const input = m.root.querySelector<HTMLInputElement>('input[aria-label="Add event"]')!;
    typeInto(input, "pa");
    const opts = [...m.root.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(opts).toEqual(["pay", "payment.timeout"]);
    typeInto(input, "refund");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(doc.model!.transitions.get("cart#0")!.events).toEqual(["add", "refund"]);
    expect(doc.model!.events).toContain("refund");
  });

  // @tg: verifies:: [[openspec:chart-inspector#Event catalogue#Suggest a known event]] {level: unit}
  it("offers pay for pa in YAML and adds the picked suggestion", () => {
    const doc = open("typed-order.vt.yaml");
    const m = show(doc, ["cart#1"]);
    const input = m.root.querySelector<HTMLInputElement>('input[aria-label="Add event"]')!;
    typeInto(input, "pa");
    const opt = [...m.root.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === "pay")!;
    expect(opt).toBeDefined();
    opt.click();
    expect(doc.model!.transitions.get("cart#1")!.events).toContain("pay");
  });
});
