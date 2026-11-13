import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { vi } from "vitest";
import { App, MarkdownView, WorkspaceLeaf, type TFile } from "obsidian";
import { ChartDocument } from "@vertepnyk/core";
import VertepnykPlugin from "../src/main.js";

// vitest runs from the workspace root or from this package
const fixtures = [resolve(process.cwd(), "fixtures"), resolve(process.cwd(), "../../fixtures")].find((d) => existsSync(join(d, "traffic-light.scxml")))!;
export const fixture = (name: string): string => readFileSync(join(fixtures, name), "utf8");
export const TRAFFIC_SCXML = fixture("traffic-light.scxml");
export const TRAFFIC_YAML = fixture("traffic-light.vt.yaml");

export const MANIFEST = { id: "vertepnyk", name: "Vertepnyk", version: "0.1.0", dir: ".obsidian/plugins/vertepnyk" };

/** A plugin on a mock app, loaded; the engine is replaced by one that fails fast (no workers in unit tests). */
export async function loadPlugin(): Promise<{ app: App; plugin: VertepnykPlugin }> {
  const app = new App();
  const plugin = new VertepnykPlugin(app as never, MANIFEST as never);
  await plugin.onload();
  plugin.assets.engine = vi.fn(async () => ({
    createSystem: async () => {
      throw new Error("no engine in unit tests");
    },
  })) as never;
  return { app, plugin };
}

/** A markdown view of `path` in source (live preview) mode with an editor holding `text`. */
export function openInEditor(app: App, file: TFile, text: string, mode: "source" | "preview" = "source"): MarkdownView {
  const leaf = new WorkspaceLeaf();
  const view = new MarkdownView(leaf as never);
  view.file = file;
  view.mode = mode;
  view.editor.setValue(text);
  app.workspace.leaves.push(leaf);
  return view;
}

/** A `setLayout` patch set for the chart text: moves `id` to (x, y). */
export function layoutPatches(text: string, format: "scxml" | "yaml", id = "red") {
  const doc = ChartDocument.open(text, format);
  return doc.apply({ type: "setLayout", states: { [id]: { x: 11, y: 22, w: 120, h: 50 } } });
}

/** A visual edit that is not layout. */
export function renamePatches(text: string, format: "scxml" | "yaml") {
  const doc = ChartDocument.open(text, format);
  return doc.apply({ type: "addState", parent: null, kind: "atomic", id: "extra" });
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
