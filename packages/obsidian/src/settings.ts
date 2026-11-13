import { PluginSettingTab, Setting, type App } from "obsidian";
import type { ViewState } from "@vertepnyk/host-bridge";
import type VertepnykPlugin from "./main.js";

export interface VertepnykSettings {
  /** Open `*.vt.yaml` (and `*.vt.yml`) in the designer; registers the `yaml`/`yml` extensions, so applies on reload. */
  openYamlInDesigner: boolean;
  /** Open `*.scxml` in the designer; off leaves the file for another plugin. Applies on reload. */
  openScxmlInDesigner: boolean;
  /** Code blocks open their simulation panel straight away. */
  autoOpenSimulation: boolean;
  /** Milliseconds between the last edit and live validation. */
  validationDelayMs: number;
  /** Height of a chart in a note, px. */
  previewHeight: number;
  /** Per-file view state (viewport, side panel tab), by vault path. */
  views: Record<string, ViewState>;
}

export const DEFAULT_SETTINGS: VertepnykSettings = {
  openYamlInDesigner: true,
  openScxmlInDesigner: true,
  autoOpenSimulation: false,
  validationDelayMs: 250,
  previewHeight: 320,
  views: {},
};

export function mergeSettings(saved: unknown): VertepnykSettings {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<VertepnykSettings>;
  return { ...DEFAULT_SETTINGS, ...s, views: { ...(s.views ?? {}) } };
}

export class VertepnykSettingTab extends PluginSettingTab {
  readonly plugin: VertepnykPlugin;

  constructor(app: App, plugin: VertepnykPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = (): Promise<void> => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName("Open .scxml files in the designer")
      .setDesc("Reload the plugin or restart Obsidian after changing this.")
      .addToggle((t) =>
        t.setValue(s.openScxmlInDesigner).onChange(async (v) => {
          s.openScxmlInDesigner = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Open .vt.yaml files in the designer")
      .setDesc("Obsidian binds a view to the last dot-segment, so this takes over every .yaml and .yml file; those that are not .vt.yaml show as plain text. Reload the plugin after changing this.")
      .addToggle((t) =>
        t.setValue(s.openYamlInDesigner).onChange(async (v) => {
          s.openYamlInDesigner = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Open the simulation panel in chart code blocks")
      .setDesc("Charts in notes start with the simulation panel open instead of the plain canvas.")
      .addToggle((t) =>
        t.setValue(s.autoOpenSimulation).onChange(async (v) => {
          s.autoOpenSimulation = v;
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Validation delay (ms)")
      .setDesc("How long after the last edit the chart is validated on vertep.")
      .addText((t) =>
        t.setValue(String(s.validationDelayMs)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0 && n <= 5000) {
            s.validationDelayMs = n;
            await save();
          }
        }),
      );
    new Setting(containerEl)
      .setName("Chart height in notes (px)")
      .addText((t) =>
        t.setValue(String(s.previewHeight)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 120 && n <= 1200) {
            s.previewHeight = n;
            await save();
          }
        }),
      );
  }
}
