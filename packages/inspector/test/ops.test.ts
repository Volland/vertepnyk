import { describe, expect, it } from "vitest";
import { ChartDocument, type ContentItem } from "@vertepnyk/core";
import { addBranch, contentOps, defaultItem, describeSelection, eventSuggestions, showTypeInput } from "../src/index.js";
import { open } from "./helpers.js";

describe("pure helpers", () => {
  // @tg: verifies:: [[openspec:chart-inspector#Event catalogue#Suggest a known event]] {level: unit}
  it("suggests known events by prefix, excluding chosen ones", () => {
    const m = open("order.scxml").model!;
    expect(eventSuggestions(m, "pa")).toEqual(["pay", "payment.timeout"]);
    expect(eventSuggestions(m, "pa", ["pay"])).toEqual(["payment.timeout"]);
    expect(eventSuggestions(m, "zzz")).toEqual([]);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit executable content#Add an assign on entry]] {level: unit}
  it("adds, moves and removes items, keeping object identity", () => {
    const a = defaultItem("raise");
    const b: ContentItem = { kind: "opaque", label: "script", source: "<script/>", span: { start: 0, end: 9 } };
    const list = contentOps.add(contentOps.add([], a), b);
    expect(contentOps.move(list, 1, -1)).toEqual([b, a]);
    expect(contentOps.move(list, 0, -1)[0]).toBe(a);
    expect(contentOps.remove(list, 0)).toEqual([b]);
    expect(contentOps.add(list, "log", 1)[1]!.kind).toBe("log");
    const iff = defaultItem("if");
    if (iff.kind !== "if") throw new Error();
    expect(addBranch(addBranch(iff, "else"), "elseif").branches.map((x) => x.cond === undefined)).toEqual([false, false, true]);
  });

  // @tg: verifies:: [[openspec:chart-inspector#Inspect the selection#Change transition type]] {level: unit}
  it("describes the selection", () => {
    const m = open("order.scxml").model!;
    expect(describeSelection(m, []).kind).toBe("chart");
    expect(describeSelection(m, ["cart"])).toEqual({ kind: "state", id: "cart" });
    expect(describeSelection(m, ["cart#0"])).toEqual({ kind: "transition", id: "cart#0" });
    expect(describeSelection(m, ["cart", "cart#0"])).toMatchObject({ kind: "multiple", states: 1, transitions: 1 });
    expect(describeSelection(m, ["nope"]).kind).toBe("missing");
  });

  // @tg: verifies:: [[openspec:chart-inspector#Edit the datamodel#Add a data item]] {level: unit}
  it("shows the type input only for typed CEL charts", () => {
    expect(showTypeInput(open("typed-order.vt.yaml").model!)).toBe(true);
    expect(showTypeInput(open("order.scxml").model!)).toBe(false);
    expect(showTypeInput(ChartDocument.open("vertep: 1\nname: x\ninitial: a\nstates:\n  a: {}\n", "yaml").model!)).toBe(false);
  });
});
