/** The chart file view: the designer on a vault file, with the view's text as the buffer. */
import { Notice, TextFileView, type TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { DesignerHandle } from "@vertepnyk/designer";
import type { Format } from "@vertepnyk/core";
import { BufferHost } from "./host.js";
import { mountDesignerIn } from "./mount.js";
import { VIEW_TYPE, chartFormat, writeBeside } from "./util.js";
import type VertepnykPlugin from "./main.js";

export type ViewMode = "designer" | "source";

// @tg: implements:: [[openspec:obsidian-plugin#Chart file view]]
export class ChartView extends TextFileView {
  readonly plugin: VertepnykPlugin;
  host: BufferHost | null = null;
  handle: DesignerHandle | undefined;
  mode: ViewMode = "designer";
  #dispose: (() => void) | undefined;
  #token = 0;
  #loadedPath: string | null = null;
  #area: HTMLElement | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: VertepnykPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.file?.basename ?? "Statechart";
  }
  getIcon(): string {
    return "workflow";
  }

  /** The format of the open file, or null for a `.yaml` file that is not a vertep chart. */
  get format(): Format | null {
    return this.file ? chartFormat(this.file.name) : null;
  }

  getViewData(): string {
    return this.data;
  }

  /**
   * Obsidian hands over the file's text after loading it (`clear` set) and again when the file
   * changes on disk or in another leaf. The first mounts the designer on a fresh host; the
   * second reaches the designer as an external text change.
   */
  // @tg: implements:: [[openspec:host-bridge#Hosts own the buffer]]
  setViewData(data: string, clear: boolean): void {
    this.data = data;
    const path = this.file?.path ?? null;
    if (!this.host || clear || path !== this.#loadedPath) {
      this.#loadedPath = path;
      void this.#mount();
    } else {
      this.host.setExternalText(data);
      if (this.mode === "source") this.#syncSource();
    }
  }

  clear(): void {
    this.#teardown();
    this.data = "";
    this.#loadedPath = null;
  }

  async onClose(): Promise<void> {
    this.#teardown();
    await super.onClose?.();
  }

  // ---- state: the view mode survives reloads ---------------------------------------------

  getState(): Record<string, unknown> {
    return { ...super.getState(), mode: this.mode };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const mode = (state as { mode?: unknown } | null)?.mode;
    if (mode === "source" || mode === "designer") this.mode = mode;
    await super.setState(state, result);
  }

  // ---- commands --------------------------------------------------------------------------

  toggleSource(): void {
    this.mode = this.mode === "designer" ? "source" : "designer";
    void this.#mount();
  }

  relayout(): Promise<void> {
    return this.handle?.canvas()?.relayout() ?? Promise.resolve();
  }

  async startSimulation(): Promise<void> {
    if (!this.handle) return;
    this.handle.selectTab("simulation");
    await this.handle.controller.startSimulation();
  }

  async resetSimulation(): Promise<void> {
    if (!this.handle) return;
    this.handle.selectTab("simulation");
    await this.handle.controller.resetSimulation();
  }

  // ---- internals -------------------------------------------------------------------------

  #teardown(): void {
    this.#token++;
    clearTimeout(this.#saveTimer);
    this.#dispose?.();
    this.#dispose = undefined;
    this.handle = undefined;
    this.host = null;
    this.#area = null;
    this.contentEl?.empty();
  }

  #makeHost(file: TFile, format: Format): BufferHost {
    const plugin = this.plugin;
    return new BufferHost({
      fileName: file.name,
      format,
      text: this.data,
      theme: plugin.theme,
      // the buffer is the view's text: a write is accepted while it still holds `before`
      commit: (before, after) => {
        if (this.data !== before) return false;
        this.data = after;
        this.requestSave();
        return true;
      },
      current: () => this.data,
      save: () => this.save(),
      viewState: { get: () => plugin.settings.views[file.path], set: (s) => plugin.setViewState(file.path, s) },
      assetUrl: (p) => plugin.assets.resourceUrl(p),
      notify: (message) => new Notice(message),
      writeFile: async (name, contents) => {
        const path = await writeBeside(plugin.app, file.path, name, contents);
        new Notice(`Saved ${path}`);
      },
    });
  }

  async #mount(): Promise<void> {
    const file = this.file;
    const data = this.data;
    this.#teardown();
    const token = this.#token;
    if (!file) return;
    const root = this.contentEl.createDiv({ cls: "vertepnyk-view" });
    this.#area = root;
    const format = this.format;
    if (format === null || this.mode === "source") {
      if (format === null) root.createDiv({ cls: "vertepnyk-note", text: `${file.name} is not a vertep chart (*.vt.yaml); showing its text.` });
      this.#mountSource(root);
      return;
    }
    this.data = data;
    const host = this.#makeHost(file, format);
    this.host = host;
    const area = root.createDiv({ cls: "vertepnyk-designer" });
    const dispose = await mountDesignerIn(this.plugin, area, host, (h) => (this.handle = h));
    if (token !== this.#token) dispose();
    else this.#dispose = dispose;
  }

  /** The text of the file in a plain editor, for the source side of the toggle. */
  #mountSource(root: HTMLElement): void {
    const ta = root.createEl("textarea", { cls: "vertepnyk-source", attr: { spellcheck: "false", "data-testid": "source" } });
    ta.value = this.data;
    ta.addEventListener("input", () => {
      this.data = ta.value;
      this.requestSave();
    });
  }

  #syncSource(): void {
    const ta = this.#area?.querySelector("textarea");
    if (ta && ta.value !== this.data) ta.value = this.data;
  }
}
