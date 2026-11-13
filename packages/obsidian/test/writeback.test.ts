import { describe, expect, it, vi } from "vitest";
import { Component, type TFile } from "obsidian";
import { ChartDocument } from "@vertepnyk/core";
import { blockTarget, locateBlock, parseBlocks, replaceBlock } from "../src/blocks.js";
import { ChartBlock } from "../src/codeblock.js";
import { ChartModal } from "../src/modal.js";
import { TRAFFIC_YAML, layoutPatches, loadPlugin, openInEditor, renamePatches } from "./helpers.js";

const BEFORE = "# Order flow\n\nSome intro that must survive.\n\n";
const AFTER = "\n\nClosing words with `inline code`.\n\n```js\nconsole.log(1)\n```\n";
const chartNote = (chart: string, lang = "vertep") => `${BEFORE}\`\`\`${lang}\n${chart}\n\`\`\`${AFTER}`;
const FENCE_LINE = BEFORE.split("\n").length - 1;
const yamlBody = TRAFFIC_YAML.replace(/\n+$/, "");

async function setup(note: string, mode: "source" | "preview") {
  const { app, plugin } = await loadPlugin();
  const file = app.vault.add("notes/order.md", note);
  const editor = mode === "source" ? openInEditor(app, file as unknown as TFile, note, "source") : openInEditor(app, file as unknown as TFile, note, "preview");
  const noteText = () => (mode === "source" ? editor.editor.getValue() : app.vault.files.get(file.path)!);
  const target = blockTarget(app as never, file.path, { lineStart: FENCE_LINE }, "vertep");
  // a preview-mode (reading) note has no editor: writes go through Vault.process
  if (mode === "preview") app.workspace.leaves = [];
  const modal = new ChartModal(plugin, { notePath: file.path, text: yamlBody, format: "yaml", target });
  return { app, plugin, file, noteText, target, modal };
}

describe("code-block write-back", () => {
  for (const mode of ["source", "preview"] as const) {
    // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: integration}
    it(`changes only the block's text through ${mode === "source" ? "the editor" : "Vault.process"}`, async () => {
      const note = chartNote(yamlBody);
      const { modal, noteText } = await setup(note, mode);
      const ok = await modal.host.applyPatches(layoutPatches(yamlBody, "yaml", "red"), "edit");
      expect(ok).toBe(true);
      const out = noteText();
      expect(out.startsWith(BEFORE + "```vertep\n")).toBe(true);
      expect(out.endsWith("\n```" + AFTER)).toBe(true);
      expect(out).not.toBe(note);
      // the block is now what the designer holds, and is a chart with the new layout
      const block = parseBlocks(out).find((b) => b.lang === "vertep")!;
      expect(block.content).toBe(modal.host.getText());
      expect(ChartDocument.open(block.content, "yaml").model).not.toBeNull();
      expect(block.content).toContain("layout");
      // the other fenced block is untouched
      expect(parseBlocks(out).find((b) => b.lang === "js")!.content).toBe("console.log(1)");
    });
  }

  // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: integration}
  it("applies several edits one after another against the block", async () => {
    const { modal, noteText } = await setup(chartNote(yamlBody), "source");
    const a = modal.host.applyPatches(layoutPatches(yamlBody, "yaml", "red"), "edit");
    await a;
    const second = renamePatches(modal.host.getText(), "yaml");
    expect(await modal.host.applyPatches(second, "edit")).toBe(true);
    expect(noteText()).toContain("extra");
    expect(noteText().startsWith(BEFORE)).toBe(true);
    expect(noteText().endsWith("```" + AFTER)).toBe(true);
  });

  for (const mode of ["source", "preview"] as const) {
    // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: integration}
    it(`refuses to write when the block changed meanwhile (${mode})`, async () => {
      const { app, file, modal, noteText } = await setup(chartNote(yamlBody), mode);
      // the user types into the block while the modal is open
      const typed = chartNote(yamlBody + "\n# typed meanwhile");
      if (mode === "source") openEditorValue(app, typed);
      else app.vault.files.set(file.path, typed);
      const seen: string[] = [];
      modal.host.onDidChangeText((t) => seen.push(t));
      const ok = await modal.host.applyPatches(renamePatches(yamlBody, "yaml"), "edit");
      expect(ok).toBe(false);
      expect(noteText()).toBe(typed);
      // the designer re-reads the block's current text
      expect(modal.host.getText()).toContain("typed meanwhile");
    });
  }

  // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: unit}
  it("refuses when the block is gone from the note", async () => {
    const { app, file, modal } = await setup(chartNote(yamlBody), "preview");
    app.vault.files.set(file.path, "nothing here");
    expect(await modal.host.applyPatches(renamePatches(yamlBody, "yaml"), "edit")).toBe(false);
    expect(app.vault.files.get(file.path)).toBe("nothing here");
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: unit}
  it("finds the block when lines moved, and picks the nearest of identical blocks", () => {
    const note = `${chartNote("a: 1")}\n\n\`\`\`vertep\na: 1\n\`\`\`\n`;
    const blocks = parseBlocks(note).filter((b) => b.lang === "vertep");
    expect(blocks).toHaveLength(2);
    expect(locateBlock(note, "a: 1")).toBeNull(); // ambiguous without a hint
    expect(locateBlock(note, "a: 1", { lineStart: blocks[1]!.fenceLine + 3 })!.fenceLine).toBe(blocks[1]!.fenceLine);
    expect(locateBlock(note, "a: 2", { lineStart: FENCE_LINE })).toBeNull();
    const out = replaceBlock(note, blocks[1]!, "b: 2\nc: 3");
    expect(parseBlocks(out).filter((b) => b.lang === "vertep").map((b) => b.content)).toEqual(["a: 1", "b: 2\nc: 3"]);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: unit}
  it("keeps CRLF line ends of the note and handles an empty block", () => {
    const note = "a\r\n```vertep\r\nx: 1\r\n```\r\nb\r\n";
    const b = parseBlocks(note)[0]!;
    expect(b.content).toBe("x: 1");
    expect(replaceBlock(note, b, "y: 2")).toBe("a\r\n```vertep\r\ny: 2\r\n```\r\nb\r\n");
    const empty = "```vertep\n```\n";
    expect(parseBlocks(empty)[0]!.content).toBe("");
    expect(replaceBlock(empty, parseBlocks(empty)[0]!, "k: 1")).toBe("```vertep\nk: 1\n```\n");
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Code-block editing writes back#Layout change in a note]] {level: integration}
  it("opens the modal designer from the Edit button on the text the note holds", async () => {
    const { app, plugin } = await loadPlugin();
    const note = chartNote(yamlBody);
    const file = app.vault.add("notes/order.md", note);
    app.workspace.leaves = [];
    const el = document.createElement("div");
    const root = new Component();
    root.load();
    const ctx = { sourcePath: file.path, addChild: (c: Component) => root.addChild(c), getSectionInfo: () => ({ text: note, lineStart: FENCE_LINE, lineEnd: FENCE_LINE + 2 }) };
    // the processor's `source` differs in a trailing newline from the note: the modal starts from the note's text
    plugin.codeBlocks.get("vertep")!(`${yamlBody}\n`, el, ctx);
    const child = root._children[0] as ChartBlock;
    const modal = (await child.edit())!;
    await vi.waitFor(() => expect(modal.contentEl.querySelector(".vd-root")).not.toBeNull());
    expect(modal.host.getText()).toBe(yamlBody);
    expect(modal.opened).toBe(true);
    expect(await modal.host.applyPatches(layoutPatches(yamlBody, "yaml", "red"), "edit")).toBe(true);
    expect(app.vault.files.get(file.path)!.startsWith(BEFORE)).toBe(true);
    modal.close();
    expect(modal.contentEl.querySelector(".vd-root")).toBeNull();
  });
});

function openEditorValue(app: import("obsidian").App, text: string): void {
  for (const l of app.workspace.leaves) (l.view as { editor: { setValue(v: string): void } }).editor.setValue(text);
}
