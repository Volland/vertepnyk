import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartDocument, newChart } from "@vertepnyk/core";
import { WebHost, formatOf, withoutLayout } from "../src/WebHost.js";
import { createThemeStore } from "../src/theme.js";

const theme = createThemeStore();
const make = (name = "a.scxml", text = newChart("scxml", "a")) => new WebHost({ fileName: name, format: formatOf(name)!, text, theme, base: "/" });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web host", () => {
  it("detects the format from the file name", () => {
    expect(formatOf("x.scxml")).toBe("scxml");
    expect(formatOf("x.vt.yaml")).toBe("yaml");
    expect(formatOf("x.txt")).toBeNull();
  });

  it("is dirty after an edit but not after layout alone", async () => {
    const host = make();
    const doc = ChartDocument.open(host.getText(), "scxml");
    const layout = doc.apply({ type: "setLayout", states: { idle: { x: 1, y: 2, w: 100, h: 40 } } });
    await host.applyPatches(layout, "edit");
    expect(host.dirty).toBe(false);
    const edit = doc.apply({ type: "addState", parent: null, kind: "atomic", id: "b" });
    await host.applyPatches(edit, "edit");
    expect(host.dirty).toBe(true);
    expect(withoutLayout(host.getText(), "scxml")).not.toContain("vl:");
  });

  it("tells the designer about typed text and the text pane about patches", async () => {
    const host = make();
    const seen: string[] = [];
    host.onDidChangeText((t) => seen.push(t));
    host.setExternalText("<scxml/>");
    expect(seen).toEqual(["<scxml/>"]);
    expect(host.dirty).toBe(true);
    const buffers: unknown[] = [];
    host.onDidChangeBuffer((c) => buffers.push(c));
    await host.applyPatches([{ start: 0, end: 1, text: "<" }], "edit");
    expect(buffers).toHaveLength(1);
  });

  // @tg: verifies:: [[openspec:web-shell#Local file access#Save without file system access]] {level: integration}
  it("saves by download under the original name without the File System Access API", async () => {
    const host = make("order.scxml");
    expect("showSaveFilePicker" in window).toBe(false);
    const names: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    host.setExternalText("<scxml/>");
    await host.save();
    expect(names).toEqual(["order.scxml"]);
    expect(host.dirty).toBe(false);
  });

  it("keeps view state per file name and survives blocked storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const host = make("v.scxml");
    host.setViewState({ viewport: { x: 1, y: 2, zoom: 3 } });
    expect(make("v.scxml").getViewState()).toEqual({ viewport: { x: 1, y: 2, zoom: 3 } });
    expect(make("other.scxml").getViewState()).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(host.getViewState()).toBeUndefined();
    expect(() => host.setViewState({})).not.toThrow();
  });

  it("resolves vertep assets under /vertep/", () => {
    expect(make().assetUrl("web/dist/worker.js")).toBe("/vertep/web/dist/worker.js");
  });
});
