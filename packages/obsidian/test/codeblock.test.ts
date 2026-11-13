import { describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";
import { TRAFFIC_SCXML, TRAFFIC_YAML, loadPlugin } from "./helpers.js";

/** Runs the code block processor of `lang` as Obsidian does: a fresh element and a context that loads children. */
async function render(lang: string, source: string, sourcePath = "note.md", sectionStart: number | null = 0) {
  const { app, plugin } = await loadPlugin();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = new Component();
  root.load();
  const ctx = {
    sourcePath,
    addChild: (c: Component) => root.addChild(c),
    getSectionInfo: () => (sectionStart === null ? null : { text: "", lineStart: sectionStart, lineEnd: sectionStart + 2 }),
  };
  plugin.codeBlocks.get(lang)!(source, el, ctx);
  return { app, plugin, el, root };
}

describe("chart code blocks", () => {
  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: integration}
  it("renders the traffic-light chart of a vertep block as a canvas", async () => {
    const { el, plugin } = await render("vertep", TRAFFIC_YAML);
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
    const names = [...el.querySelectorAll(".vt-name")].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(["red", "green", "yellow", "operating"]));
    expect(el.querySelector(".vertepnyk-block-bar")).not.toBeNull();
    // read-only: no editing toolbar, and the engine has not been touched
    expect(el.querySelector(".vt-toolbar")).toBeNull();
    expect(plugin.assets.engine).not.toHaveBeenCalled();
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: integration}
  it("renders an scxml block", async () => {
    const { el } = await render("scxml", TRAFFIC_SCXML);
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: unit}
  it("takes SCXML in a vertep block by its first character", async () => {
    const { el } = await render("vertep", TRAFFIC_SCXML);
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: unit}
  it("says so when the block does not parse", async () => {
    const { el } = await render("scxml", "<scxml><state></scxml>");
    await vi.waitFor(() => expect(el.querySelector("[data-testid=chart-error]")).not.toBeNull());
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: integration}
  it("opens the simulation panel in place, starting the engine only then", async () => {
    const { el, plugin } = await render("vertep", TRAFFIC_YAML);
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
    expect(plugin.assets.engine).not.toHaveBeenCalled();
    (el.querySelector("[data-testid=open-simulation]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(plugin.assets.engine).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(el.querySelector("[data-testid=tab-simulation][aria-selected=true]")).not.toBeNull());
    // the in-place designer is read-only: edits go through the modal
    expect(el.querySelector(".vd-readonly")).not.toBeNull();
    // and back
    (el.querySelector("[data-testid=open-simulation]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el.querySelector("[data-testid=tab-simulation]")).toBeNull());
    expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(0);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: unit}
  it("can start with the simulation panel open (setting)", async () => {
    const { app, plugin } = await loadPlugin();
    plugin.settings.autoOpenSimulation = true;
    const el = document.createElement("div");
    const root = new Component();
    root.load();
    plugin.codeBlocks.get("vertep")!(TRAFFIC_YAML, el, { sourcePath: "n.md", addChild: (c: Component) => root.addChild(c), getSectionInfo: () => null });
    await vi.waitFor(() => expect(el.querySelector("[data-testid=tab-simulation]")).not.toBeNull());
    expect(app).toBeDefined();
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart code blocks#Simulate a chart in a note]] {level: unit}
  it("tears down with the note", async () => {
    const { el, root } = await render("vertep", TRAFFIC_YAML);
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(0));
    root.unload();
    expect(el.querySelector(".vt-state")).toBeNull();
  });
});
