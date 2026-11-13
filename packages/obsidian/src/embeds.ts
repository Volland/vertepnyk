/** `![[order.scxml]]`: chart files embedded in notes. */
import { Component, MarkdownRenderChild, TFile, type MarkdownPostProcessorContext } from "obsidian";
import type { LayoutClient } from "@vertepnyk/layout";
import { mountReadOnlyChart } from "./chart.js";
import { chartFormat, isChartFileName, linkFileName } from "./util.js";
import type VertepnykPlugin from "./main.js";

/** The chart file `src` (an embed's link text) points to, from the note at `sourcePath`. */
export function resolveChartFile(plugin: VertepnykPlugin, src: string, sourcePath: string): TFile | null {
  const name = linkFileName(src);
  if (!isChartFileName(name)) return null;
  return plugin.app.metadataCache.getFirstLinkpathDest(name, sourcePath);
}

/** A chart file drawn read-only inside `el`, redrawn when the file changes. */
// @tg: implements:: [[openspec:obsidian-plugin#Embeds and links]]
export class ChartEmbed extends MarkdownRenderChild {
  #dispose: (() => void) | undefined;
  #layout: LayoutClient | undefined;
  #token = 0;

  constructor(
    readonly plugin: VertepnykPlugin,
    readonly file: TFile,
    el: HTMLElement,
  ) {
    super(el);
  }

  onload(): void {
    this.registerEvent(
      this.plugin.app.vault.on("modify", (f) => {
        if (f instanceof TFile && f.path === this.file.path) void this.render();
      }),
    );
    void this.render();
  }

  onunload(): void {
    this.#token++;
    this.#teardown();
  }

  #teardown(): void {
    this.#dispose?.();
    this.#dispose = undefined;
    this.#layout?.dispose();
    this.#layout = undefined;
    this.containerEl.empty();
  }

  async render(): Promise<void> {
    const token = ++this.#token;
    const { plugin, file } = this;
    const text = await plugin.app.vault.cachedRead(file);
    const layoutClient = await plugin.assets.layoutClient({ inProcess: true });
    if (token !== this.#token) return layoutClient.dispose();
    this.#teardown();
    this.#layout = layoutClient;
    const el = this.containerEl;
    el.addClass("vertepnyk-block", "vertepnyk-embed");
    const bar = el.createDiv({ cls: "vertepnyk-block-bar" });
    bar.createSpan({ cls: "vertepnyk-block-title", text: file.name });
    const open = bar.createEl("button", { cls: "vertepnyk-btn", text: "Open in designer", attr: { "data-testid": "open-embed" } });
    open.addEventListener("click", () => void plugin.app.workspace.getLeaf("tab").openFile(file));
    const body = el.createDiv({ cls: "vertepnyk-block-body" });
    body.style.height = `${plugin.settings.previewHeight}px`;
    body.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) e.stopPropagation();
      },
      { capture: true },
    );
    this.#dispose = mountReadOnlyChart(body, { text, format: chartFormat(file.name) ?? "scxml", theme: plugin.theme, layoutClient });
  }
}

/**
 * Obsidian shows an embed of a file type it does not render as `span.internal-embed[src]`; the
 * post processor swaps those that point at a chart file for the chart.
 */
export function embedPostProcessor(plugin: VertepnykPlugin) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    for (const span of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed[src]"))) {
      if (span.dataset.vertepnyk) continue;
      const file = resolveChartFile(plugin, span.getAttribute("src") ?? "", ctx.sourcePath);
      if (!file) continue;
      span.dataset.vertepnyk = "1";
      span.empty();
      ctx.addChild(new ChartEmbed(plugin, file, span));
    }
  };
}

/**
 * Live preview draws embeds of non-markdown files through Obsidian's embed registry, which is
 * not part of the public API. Registered when present and ignored when not.
 */
// @tg: implements:: [[openspec:obsidian-plugin#Embeds and links]] {confidence: partial, note: "live preview uses a private registry that cannot be tested headless"}
export function registerEmbedCreator(plugin: VertepnykPlugin): boolean {
  const registry = (plugin.app as unknown as { embedRegistry?: { registerExtensions?: (ext: string[], creator: unknown) => void; unregisterExtensions?: (ext: string[]) => void } }).embedRegistry;
  if (!registry?.registerExtensions) return false;
  const creator = (info: { containerEl: HTMLElement }, file: TFile): Component => {
    const child = new ChartEmbed(plugin, file, info.containerEl);
    return Object.assign(child, { loadFile: () => child.render() });
  };
  try {
    registry.registerExtensions(["scxml"], creator);
    plugin.register(() => registry.unregisterExtensions?.(["scxml"]));
    return true;
  } catch (e) {
    console.warn("vertepnyk: the embed registry refused the chart embed", e);
    return false;
  }
}
