/** A modal designer for a chart that lives in a note's code block. */
import { Modal, Notice } from "obsidian";
import type { DesignerHandle } from "@vertepnyk/designer";
import type { Format } from "@vertepnyk/core";
import { BufferHost } from "./host.js";
import type { BlockTarget } from "./blocks.js";
import { mountDesignerIn } from "./mount.js";
import { writeBeside } from "./util.js";
import type VertepnykPlugin from "./main.js";

export interface BlockEdit {
  /** The note's path. */
  notePath: string;
  /** The block's text as read from the note when the modal opens. */
  text: string;
  format: Format;
  target: BlockTarget;
}

/**
 * The host of a block's designer: the designer's text is the block's text, and every patch is
 * written back through `target`, which refuses when the block no longer holds the text the
 * designer last saw (typing in the note meanwhile). The designer then re-reads the block.
 */
// @tg: implements:: [[openspec:obsidian-plugin#Code-block editing writes back]]
export function createBlockHost(plugin: VertepnykPlugin, edit: BlockEdit): BufferHost {
  return new BufferHost({
    fileName: edit.format === "scxml" ? "chart.scxml" : "chart.vt.yaml",
    format: edit.format,
    text: edit.text,
    theme: plugin.theme,
    commit: (before, after) => edit.target.write(before, after),
    current: () => edit.target.read(),
    notify: (message) => new Notice(message),
    writeFile: async (name, contents) => {
      const path = await writeBeside(plugin.app, edit.notePath, name, contents);
      new Notice(`Saved ${path}`);
    },
  });
}

export class ChartModal extends Modal {
  readonly host: BufferHost;
  handle: DesignerHandle | undefined;
  #dispose: (() => void) | undefined;
  #closed = false;

  constructor(
    readonly plugin: VertepnykPlugin,
    readonly edit: BlockEdit,
  ) {
    super(plugin.app);
    this.host = createBlockHost(plugin, edit);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("mod-vertepnyk");
    this.contentEl.addClass("vertepnyk-modal");
    const dispose = await mountDesignerIn(this.plugin, this.contentEl, this.host, (h) => (this.handle = h));
    if (this.#closed) dispose();
    else this.#dispose = dispose;
  }

  onClose(): void {
    this.#closed = true;
    this.#dispose?.();
    this.#dispose = undefined;
    this.contentEl.empty();
  }
}
