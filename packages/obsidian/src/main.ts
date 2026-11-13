/** Vertepnyk for Obsidian: the vertep statechart designer in the vault. */
import { Notice, Plugin, TFile, TFolder, normalizePath, type WorkspaceLeaf } from "obsidian";
import { newChart, type Format } from "@vertepnyk/core";
import type { ViewState } from "@vertepnyk/host-bridge";
import { EngineAssets } from "./assets.js";
import { withEmbeddedAssets } from "./embedded.js";
import { registerCodeBlocks } from "./codeblock.js";
import { embedPostProcessor, registerEmbedCreator } from "./embeds.js";
import { DEFAULT_SETTINGS, VertepnykSettingTab, mergeSettings, type VertepnykSettings } from "./settings.js";
import { ThemeSource } from "./theme.js";
import { VIEW_TYPE, isChartFileName } from "./util.js";
import { ChartView } from "./view.js";

export default class VertepnykPlugin extends Plugin {
  settings: VertepnykSettings = DEFAULT_SETTINGS;
  theme!: ThemeSource;
  assets!: EngineAssets;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  // @tg: implements:: [[openspec:obsidian-plugin#Chart file view]] {confidence: partial, note: "compound extension binding needs a real Obsidian; see registerExtensions below"}
  // @tg: implements:: [[openspec:obsidian-plugin#Obsidian distribution]]
  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.theme = new ThemeSource();
    this.registerEvent(this.app.workspace.on("css-change", () => this.theme.refresh()));
    const dir = this.manifest.dir ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    this.assets = new EngineAssets(withEmbeddedAssets(this.app.vault.adapter), dir);

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new ChartView(leaf, this));
    // Obsidian binds a view to the last dot-segment of a file name, so `vt.yaml` cannot be
    // registered: `yaml` and `yml` are, and ChartView shows a file that is not `*.vt.yaml` as text.
    const extensions = [...(this.settings.openScxmlInDesigner ? ["scxml"] : []), ...(this.settings.openYamlInDesigner ? ["yaml", "yml"] : [])];
    for (const ext of extensions) {
      try {
        this.registerExtensions([ext], VIEW_TYPE);
      } catch (e) {
        // another plugin owns the extension
        console.warn(`vertepnyk: cannot bind .${ext} files`, e);
        new Notice(`Vertepnyk: .${ext} files are already handled by another plugin; open charts with the "Open in designer" command.`);
      }
    }

    registerCodeBlocks(this);
    this.registerMarkdownPostProcessor(embedPostProcessor(this));
    registerEmbedCreator(this);
    this.addSettingTab(new VertepnykSettingTab(this.app, this));
    this.#addCommands();
  }

  onunload(): void {
    clearTimeout(this.#saveTimer);
    this.assets?.dispose();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Remembers a file's view state (viewport, tab) across sessions. */
  setViewState(path: string, state: ViewState): void {
    this.settings.views[path] = state;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.saveSettings(), 1000);
  }

  /** The chart view that has focus, if any. */
  activeChartView(): ChartView | null {
    const v = this.app.workspace.getActiveViewOfType(ChartView);
    return v ?? null;
  }

  async newChart(format: Format): Promise<TFile> {
    const active = this.app.workspace.getActiveFile();
    const folder = active?.parent ?? this.app.vault.getRoot();
    const base = folder instanceof TFolder && folder.path !== "/" ? `${folder.path}/` : "";
    const ext = format === "scxml" ? "scxml" : "vt.yaml";
    let n = 0;
    let path = normalizePath(`${base}untitled.${ext}`);
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${base}untitled ${++n}.${ext}`);
    const file = await this.app.vault.create(path, newChart(format, "untitled"));
    await this.#openInDesigner(file);
    return file;
  }

  async #openInDesigner(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
  }

  #addCommands(): void {
    this.addCommand({ id: "new-scxml", name: "New SCXML chart", callback: () => void this.newChart("scxml") });
    this.addCommand({ id: "new-yaml", name: "New YAML chart", callback: () => void this.newChart("yaml") });
    this.addCommand({
      id: "open-designer",
      name: "Open as designer",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !isChartFileName(f.name) || this.activeChartView()) return false;
        if (!checking) void this.#openInDesigner(f);
        return true;
      },
    });
    this.addCommand({
      id: "toggle-source",
      name: "Toggle source and designer",
      checkCallback: (checking) => {
        const v = this.activeChartView();
        if (!v) return false;
        if (!checking) v.toggleSource();
        return true;
      },
    });
    this.addCommand({
      id: "relayout",
      name: "Relayout chart",
      checkCallback: (checking) => {
        const v = this.activeChartView();
        if (!v?.handle) return false;
        if (!checking) void v.relayout();
        return true;
      },
    });
    this.addCommand({
      id: "simulation-start",
      name: "Start simulation",
      checkCallback: (checking) => {
        const v = this.activeChartView();
        if (!v?.handle) return false;
        if (!checking) void v.startSimulation();
        return true;
      },
    });
    this.addCommand({
      id: "simulation-reset",
      name: "Reset simulation",
      checkCallback: (checking) => {
        const v = this.activeChartView();
        if (!v?.handle) return false;
        if (!checking) void v.resetSimulation();
        return true;
      },
    });
  }
}

