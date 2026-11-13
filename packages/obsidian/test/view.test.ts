import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { ChartView } from "../src/view.js";
import { WorkspaceLeaf } from "obsidian";
import { TRAFFIC_SCXML, TRAFFIC_YAML, layoutPatches, loadPlugin, renamePatches } from "./helpers.js";

/** Opens `path`; waits for the designer's first automatic layout, which writes into the file. */
async function openView(path: string, text: string, designer = true) {
  const { app, plugin } = await loadPlugin();
  const file = app.vault.add(path, text);
  const view = new ChartView(new WorkspaceLeaf() as never, plugin);
  view.app = app;
  await view.onLoadFile(file as never);
  if (designer) {
    await vi.waitFor(() => expect(view.handle).toBeDefined());
    await vi.waitFor(() => expect(view.saveRequests).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
  }
  return { app, plugin, file, view };
}

describe("chart file view", () => {
  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: integration}
  it("opens a chart file in the designer and saves edits to the vault file", async () => {
    const { app, file, view } = await openView("charts/order.scxml", TRAFFIC_SCXML);
    expect(view.getViewType()).toBe("vertepnyk-designer");
    expect(view.contentEl.querySelector(".vd-root")).not.toBeNull();
    await vi.waitFor(() => expect(view.contentEl.querySelectorAll(".vt-state").length).toBeGreaterThan(3));

    const before = view.data;
    const saves = view.saveRequests;
    await view.host!.applyPatches(layoutPatches(before, "scxml"), "edit");
    expect(view.saveRequests).toBe(saves + 1);
    expect(view.data).not.toBe(before);
    expect(view.data).toContain('vl:x="11"');

    await view.save();
    expect(app.vault.files.get(file.path)).toBe(view.data);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("opens a .vt.yaml chart in the designer", async () => {
    const { view } = await openView("charts/light.vt.yaml", TRAFFIC_YAML);
    expect(view.format).toBe("yaml");
    expect(view.host?.format).toBe("yaml");
    expect(view.contentEl.querySelector(".vd-root")).not.toBeNull();
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("takes a changed file from Obsidian as an external edit", async () => {
    const { view } = await openView("a.scxml", TRAFFIC_SCXML);
    const changed = TRAFFIC_SCXML.replace('id="flashing"', 'id="blinking"').replace('target="flashing"', 'target="blinking"');
    view.setViewData(changed, false);
    expect(view.handle!.controller.doc.text).toBe(changed);
    expect(view.handle!.controller.doc.model!.states.has("blinking")).toBe(true);
  });

  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: integration}
  it("marks the document modified after a visual edit", async () => {
    const { view } = await openView("a.scxml", TRAFFIC_SCXML);
    const saves = view.saveRequests;
    await view.host!.applyPatches(renamePatches(view.data, "scxml"), "edit");
    expect(view.saveRequests).toBe(saves + 1);
    expect(view.getViewData()).toContain('id="extra"');
  });

  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: unit}
  it("refuses a patch when the buffer changed under the designer", async () => {
    const { view } = await openView("a.scxml", TRAFFIC_SCXML);
    const patches = renamePatches(view.data, "scxml");
    const saves = view.saveRequests;
    view.data = `${view.data}\n<!-- typed elsewhere -->`;
    expect(await view.host!.applyPatches(patches, "edit")).toBe(false);
    expect(view.data).toContain("typed elsewhere");
    expect(view.saveRequests).toBe(saves);
    expect(view.host!.getText()).toBe(view.data);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("shows a .yaml file that is not a vertep chart as text", async () => {
    const { view } = await openView("config.yaml", "a: 1\n", false);
    expect(view.format).toBeNull();
    expect(view.host).toBeNull();
    expect(view.contentEl.querySelector(".vertepnyk-note")?.textContent).toContain("not a vertep chart");
    const ta = view.contentEl.querySelector("textarea")!;
    expect(ta.value).toBe("a: 1\n");
    ta.value = "a: 2\n";
    ta.dispatchEvent(new Event("input"));
    expect(view.data).toBe("a: 2\n");
    expect(view.saveRequests).toBe(1);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("toggles between the designer and the source", async () => {
    const { view } = await openView("a.scxml", TRAFFIC_SCXML);
    view.toggleSource();
    await vi.waitFor(() => expect(view.contentEl.querySelector("textarea")).not.toBeNull());
    expect(view.contentEl.querySelector(".vd-root")).toBeNull();
    expect(view.getState().mode).toBe("source");
    view.toggleSource();
    await vi.waitFor(() => expect(view.contentEl.querySelector(".vd-root")).not.toBeNull());
  });

  // @tg: verifies:: [[openspec:host-bridge#Host persists view state#Viewport restored]] {level: unit}
  it("keeps the view state of a file across reopening", async () => {
    const { plugin, view, file } = await openView("a.scxml", TRAFFIC_SCXML);
    view.host!.setViewState({ viewport: { x: 5, y: 6, zoom: 2 }, tab: "problems" });
    expect(plugin.settings.views[file.path]).toEqual({ viewport: { x: 5, y: 6, zoom: 2 }, tab: "problems" });
    view.clear();
    await view.onLoadFile(file as never);
    await vi.waitFor(() => expect(view.host).not.toBeNull());
    expect(view.host!.getViewState()).toEqual({ viewport: { x: 5, y: 6, zoom: 2 }, tab: "problems" });
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("registers the view and binds scxml and yaml files to it", async () => {
    const { plugin } = await loadPlugin();
    expect(plugin.views.has("vertepnyk-designer")).toBe(true);
    expect(plugin.extensions.get("scxml")).toBe("vertepnyk-designer");
    // Obsidian binds the last dot-segment: `vt.yaml` itself cannot be registered
    expect(plugin.extensions.get("yaml")).toBe("vertepnyk-designer");
    expect([...plugin.extensions.keys()].some((k) => k.includes("."))).toBe(false);
    for (const id of ["new-scxml", "new-yaml", "open-designer", "toggle-source", "relayout", "simulation-start", "simulation-reset"]) expect(plugin.commands.has(id)).toBe(true);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Chart file view#Open from the file explorer]] {level: unit}
  it("creates a new chart next to the active file", async () => {
    const { app, plugin } = await loadPlugin();
    const note = app.vault.add("notes/n.md", "");
    note.parent = Object.assign(Object.create(app.vault.root), { path: "notes" });
    app.workspace.activeFile = note;
    const f = await plugin.newChart("yaml");
    expect(f.path).toBe("notes/untitled.vt.yaml");
    expect(app.vault.files.get(f.path)).toContain("untitled");
    const g = await plugin.newChart("yaml");
    expect(g.path).toBe("notes/untitled 1.vt.yaml");
  });
});
