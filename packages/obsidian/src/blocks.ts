/**
 * Fenced chart blocks inside a note: finding one, and replacing only its content. A write is
 * accepted only when the block still holds the text the designer was opened with.
 */
import { MarkdownView, TFile, type App } from "obsidian";
import type { Format } from "@vertepnyk/core";

export const CHART_LANGS = ["scxml", "vertep"] as const;

export interface BlockLocation {
  readonly lang: string;
  /** 0-based line of the opening fence. */
  readonly fenceLine: number;
  /** 0-based line of the first content line (`fenceLine + 1`). */
  readonly startLine: number;
  /** 0-based line of the closing fence (the content ends before it). */
  readonly endLine: number;
  /** Content lines joined by `\n`, without the final newline. */
  readonly content: string;
}

export interface BlockHint {
  /** 0-based line of the opening fence, from `MarkdownPostProcessorContext.getSectionInfo`. */
  readonly lineStart: number;
}

const OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

/** Every fenced block of the note (language is the first word of the info string). */
export function parseBlocks(note: string): BlockLocation[] {
  const lines = note.split(/\r?\n/);
  const out: BlockLocation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!);
    if (!m) continue;
    const fence = m[2]!;
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j]!)) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    out.push({ lang: m[3]!, fenceLine: i, startLine: i + 1, endLine: end, content: lines.slice(i + 1, end).join("\n") });
    i = end;
  }
  return out;
}

/**
 * The block that holds `expected`: at the hinted line when it does, else the only chart block
 * with that content (the nearest to the hint among several). `null` when there is none.
 */
export function locateBlock(note: string, expected: string, hint?: BlockHint): BlockLocation | null {
  const blocks = parseBlocks(note).filter((b) => (CHART_LANGS as readonly string[]).includes(b.lang));
  const at = hint ? blocks.find((b) => b.fenceLine === hint.lineStart) : undefined;
  if (at && at.content === expected) return at;
  const same = blocks.filter((b) => b.content === expected);
  if (same.length === 1) return same[0]!;
  if (same.length > 1 && hint) return [...same].sort((a, b) => Math.abs(a.fenceLine - hint.lineStart) - Math.abs(b.fenceLine - hint.lineStart))[0]!;
  return null;
}

/** The block at the hinted line (whatever it holds now), for re-reading after a refusal. */
export function blockAt(note: string, hint: BlockHint): BlockLocation | null {
  return parseBlocks(note).find((b) => b.fenceLine === hint.lineStart && (CHART_LANGS as readonly string[]).includes(b.lang)) ?? null;
}

/** `note` with the content of `block` replaced by `next`; every other character is kept. */
export function replaceBlock(note: string, block: BlockLocation, next: string): string {
  const eol = note.includes("\r\n") ? "\r\n" : "\n";
  const lines = note.split(/\r?\n/);
  const replacement = next === "" ? [] : next.split("\n");
  lines.splice(block.startLine, block.endLine - block.startLine, ...replacement);
  return lines.join(eol);
}

/** Chart format of a block: SCXML for `scxml` and for XML-looking `vertep` blocks, else YAML. */
export function blockFormat(lang: string, content: string): Format {
  return lang === "scxml" || content.trimStart().startsWith("<") ? "scxml" : "yaml";
}

/** Where a block lives, and how to read and write it. */
export interface BlockTarget {
  /** The block's current text (at its place in the note), or null when it is gone. */
  read(): Promise<string | null>;
  /** Replaces the block's content when it still equals `before`; false = refused, nothing written. */
  write(before: string, after: string): Promise<boolean>;
}

/** The markdown editor showing `path` in source or live-preview mode, if there is one. */
export function editorFor(app: App, path: string): NonNullable<MarkdownView["editor"]> | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const v = leaf.view;
    if (v instanceof MarkdownView && v.file?.path === path && v.getMode() === "source") return v.editor;
  }
  return null;
}

/**
 * A block of the note at `path`. Written through the editor (live preview and source mode:
 * the edit joins the editor's undo history and nothing is clobbered) or, when the note is in
 * reading mode or closed, through `Vault.process` (atomic read-modify-write on the file).
 */
// @tg: implements:: [[openspec:obsidian-plugin#Code-block editing writes back]]
export function blockTarget(app: App, path: string, hint: BlockHint | undefined, lang: string): BlockTarget {
  const file = (): TFile | null => {
    const f = app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  };
  const noteText = async (): Promise<string | null> => {
    const ed = editorFor(app, path);
    if (ed) return ed.getValue();
    const f = file();
    return f ? app.vault.read(f) : null;
  };
  return {
    async read() {
      const text = await noteText();
      if (text === null) return null;
      const lines = hint ? blockAt(text, hint) : null;
      return lines && lines.lang === lang ? lines.content : null;
    },
    async write(before, after) {
      const ed = editorFor(app, path);
      if (ed) {
        const note = ed.getValue();
        const b = locateBlock(note, before, hint);
        if (!b) return false;
        const from = { line: b.startLine, ch: 0 };
        const to = { line: b.endLine, ch: 0 };
        // the block's lines including their line ends, replaced as one range
        const old = before === "" ? "" : `${before}\n`;
        if (ed.getRange(from, to).replace(/\r\n/g, "\n") !== old) return false;
        ed.replaceRange(after === "" ? "" : `${after}\n`, from, to);
        return true;
      }
      const f = file();
      if (!f) return false;
      let done = false;
      await app.vault.process(f, (data) => {
        const b = locateBlock(data, before, hint);
        if (!b) return data;
        done = true;
        return replaceBlock(data, b, after);
      });
      return done;
    },
  };
}
