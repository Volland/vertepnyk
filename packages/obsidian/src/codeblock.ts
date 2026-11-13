/** `scxml` and `vertep` code blocks: a read-only canvas, an in-place simulation and a modal editor. */
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import type { DesignerHandle } from "@vertepnyk/designer";
import type { LayoutClient } from "@vertepnyk/layout";
import { BufferHost } from "./host.js";
import { blockFormat, blockTarget, type BlockHint } from "./blocks.js";
import { mountReadOnlyChart } from "./chart.js";
import { mountDesignerIn } from "./mount.js";
import { ChartModal } from "./modal.js";
import type VertepnykPlugin from "./main.js";

export interface ChartBlockInit {
  plugin: VertepnykPlugin;
  lang: string;
  source: string;
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
}

/** One rendered block; Obsidian unloads it when the note re-renders. */
// @tg: implements:: [[openspec:obsidian-plugin#Chart code blocks]]
export class ChartBlock extends MarkdownRenderChild {
  readonly #i: ChartBlockInit;
  #dispose: (() => void) | undefined;
  #layout: LayoutClient | undefined;
  #body!: HTMLElement;
  #simButton!: HTMLButtonElement;
  #simulating = false;
  #token = 0;
  handle: DesignerHandle | undefined;

  constructor(init: ChartBlockInit) {
    super(init.el);
    this.#i = init;
  }

  get simulating(): boolean {
    return this.#simulating;
  }

  onload(): void {
    const { el, plugin } = this.#i;
    el.empty();
    el.addClass("vertepnyk-block");
    const bar = el.createDiv({ cls: "vertepnyk-block-bar" });
    bar.createSpan({ cls: "vertepnyk-block-title", text: "Statechart" });
    this.#simButton = bar.createEl("button", { cls: "vertepnyk-btn", text: "Open simulation", attr: { "data-testid": "open-simulation" } });
    this.#simButton.addEventListener("click", () => void this.toggleSimulation());
    const edit = bar.createEl("button", { cls: "vertepnyk-btn", text: "Edit", attr: { "data-testid": "edit-block" } });
    edit.addEventListener("click", () => void this.edit());
    this.#body = el.createDiv({ cls: "vertepnyk-block-body" });
    this.#body.style.height = `${plugin.settings.previewHeight}px`;
    // scrolling the note over a chart scrolls the note; Ctrl/Cmd+scroll zooms the chart
    this.#body.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
      },
      { capture: true },
    );
    if (plugin.settings.autoOpenSimulation) void this.toggleSimulation();
    else void this.showCanvas();
  }

  onunload(): void {
    this.#token++;
    this.#teardown();
  }

  #teardown(): void {
    this.#dispose?.();
    this.#dispose = undefined;
    this.handle = undefined;
    this.#body?.empty();
  }

  /** The plain read-only canvas. The engine is not touched. */
  async showCanvas(): Promise<void> {
    const token = ++this.#token;
    this.#teardown();
    this.#simulating = false;
    this.#simButton.setText("Open simulation");
    this.#body.style.height = `${this.#i.plugin.settings.previewHeight}px`;
    const { plugin, source, lang } = this.#i;
    // charts in notes lay out on the UI thread: a worker per block would not pay off
    const layoutClient = await plugin.assets.layoutClient({ inProcess: true });
    if (token !== this.#token) return layoutClient.dispose();
    this.#layout = layoutClient;
    const off = mountReadOnlyChart(this.#body, { text: source, format: blockFormat(lang, source), theme: plugin.theme, layoutClient });
    this.#dispose = () => {
      off();
      layoutClient.dispose();
    };
  }

  /** Swaps the canvas for a read-only designer with the simulation panel open, and back. */
  async toggleSimulation(): Promise<void> {
    if (this.#simulating) return this.showCanvas();
    const token = ++this.#token;
    this.#teardown();
    this.#simulating = true;
    this.#simButton.setText("Close simulation");
    this.#body.style.height = `${Math.max(this.#i.plugin.settings.previewHeight, 480)}px`;
    const { plugin, source, lang } = this.#i;
    const host = new BufferHost({
      fileName: blockFormat(lang, source) === "scxml" ? "chart.scxml" : "chart.vt.yaml",
      format: blockFormat(lang, source),
      text: source,
      readOnly: true,
      theme: plugin.theme,
    });
    const dispose = await mountDesignerIn(plugin, this.#body, host, (h) => {
      this.handle = h;
      h.selectTab("simulation");
    });
    if (token !== this.#token) return dispose();
    this.#dispose = dispose;
  }

  /** Opens the modal designer; it writes back into this block only. */
  async edit(): Promise<ChartModal | null> {
    const { plugin, ctx, el, lang, source } = this.#i;
    const info = ctx.getSectionInfo(el);
    const hint: BlockHint | undefined = info ? { lineStart: info.lineStart } : undefined;
    const target = blockTarget(plugin.app, ctx.sourcePath, hint, lang);
    // the text in the note, so that the designer starts from exactly what a write must match
    const text = (await target.read()) ?? source;
    const modal = new ChartModal(plugin, { notePath: ctx.sourcePath, text, format: blockFormat(lang, text), target });
    modal.open();
    return modal;
  }
}

/** Registers the `scxml` and `vertep` code block processors. */
export function registerCodeBlocks(plugin: VertepnykPlugin): void {
  for (const lang of ["scxml", "vertep"]) {
    plugin.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
      ctx.addChild(new ChartBlock({ plugin, lang, source, el, ctx }));
    });
  }
}
