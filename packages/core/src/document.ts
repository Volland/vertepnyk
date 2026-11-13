/**
 * The chart document: the text (the only source of truth), its last good semantic view, the
 * current parse error, commands applied as patches, and undo/redo.
 */
import {
  EditError,
  type ChangeOrigin,
  type ChartModel,
  type Command,
  type DocumentChange,
  type Format,
  type ParseError,
  type Position,
  type TextPatch,
} from "./model.js";
import { EditSession, SCXML_NS, type Backend, type Parsed } from "./backend.js";
import { ChartParseFailure } from "./errors.js";
import { applyPatches, invertPatches, lineStarts, positionAt } from "./text.js";
import { UndoStack } from "./undo.js";
import { scxmlBackend } from "./xml/edit.js";
import { yamlBackend } from "./yaml/edit.js";

function backendFor(format: Format): Backend {
  return (format === "scxml" ? scxmlBackend : yamlBackend) as Backend;
}

type ParseResult = { ok: true; parsed: Parsed } | { ok: false; error: ParseError };

function tryParse(backend: Backend, text: string): ParseResult {
  try {
    return { ok: true, parsed: backend.parse(text) };
  } catch (e) {
    if (e instanceof ChartParseFailure) return { ok: false, error: e.info };
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { message, offset: 0, line: 1, column: 1 } };
  }
}

// @tg: implements:: [[openspec:chart-document#Supported chart formats]]
// @tg: implements:: [[openspec:chart-document#Text is the source of truth]]
// @tg: implements:: [[openspec:chart-document#Undo and redo]]
// @tg: implements:: [[openspec:chart-document#Unparseable text is not overwritten]]
/** One open chart: text, model, commands, undo/redo and change notifications. */
export class ChartDocument {
  readonly format: Format;
  private readonly backend: Backend;
  private _text: string;
  private parsed: Parsed | null = null;
  private _error: ParseError | null = null;
  private starts: number[] | null = null;
  private readonly history = new UndoStack();
  private readonly listeners = new Set<(c: DocumentChange) => void>();

  private constructor(text: string, format: Format) {
    this.format = format;
    this.backend = backendFor(format);
    this._text = text;
    this.reparse();
  }

  static open(text: string, format: Format): ChartDocument {
    return new ChartDocument(text, format);
  }

  get text(): string {
    return this._text;
  }

  /** The last successfully parsed model (kept while the text does not parse). */
  get model(): ChartModel | null {
    return this.parsed?.model ?? null;
  }

  get error(): ParseError | null {
    return this._error;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  private reparse(): void {
    const r = tryParse(this.backend, this._text);
    if (r.ok) {
      this.parsed = r.parsed;
      this._error = null;
    } else this._error = r.error;
  }

  private emit(patches: readonly TextPatch[], origin: ChangeOrigin): void {
    const change: DocumentChange = { text: this._text, patches, model: this.model, error: this._error, origin };
    for (const l of [...this.listeners]) l(change);
  }

  /** Replace the text (an external change: another editor, git). Re-parses; clears history. */
  setText(text: string, origin: ChangeOrigin = "external"): void {
    if (text === this._text && origin === "external") return;
    this._text = text;
    this.starts = null;
    this.reparse();
    if (origin === "external" || origin === "edit") this.history.clear();
    this.emit([], origin);
  }

  /**
   * Apply one command or a batch atomically. Returns the patches against the previous text.
   * Throws `EditError` (the text is unchanged), or `EditError("ParseError")` while the text
   * does not parse.
   */
  apply(cmd: Command | readonly Command[], opts?: { mergeKey?: string }): readonly TextPatch[] {
    if (this._error || !this.parsed) {
      throw new EditError("ParseError", `the chart text does not parse: ${this._error?.message ?? "no model"}`);
    }
    const cmds: readonly Command[] = Array.isArray(cmd) ? cmd : [cmd as Command];
    const session = new EditSession((t) => this.backend.parse(t), this.parsed);
    for (const c of cmds) this.backend.apply(session, c);
    const patches = session.patches;
    if (patches.length === 0 || session.text === this._text) return [];
    const before = this._text;
    this._text = session.text;
    this.starts = null;
    this.parsed = session.parsed;
    this._error = null;
    this.history.push(before, this._text, patches, opts?.mergeKey);
    this.emit(patches, "edit");
    return patches;
  }

  undo(): boolean {
    const step = this.history.undo();
    if (!step) return false;
    const patches = invertPatches(step.before, step.patches);
    this.restore(step.before);
    this.emit(patches, "undo");
    return true;
  }

  redo(): boolean {
    const step = this.history.redo();
    if (!step) return false;
    this.restore(step.after);
    this.emit(step.patches, "redo");
    return true;
  }

  private restore(text: string): void {
    this._text = text;
    this.starts = null;
    this.reparse();
  }

  onChange(listener: (c: DocumentChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  positionAt(offset: number): Position {
    this.starts ??= lineStarts(this._text);
    return positionAt(this._text, offset, this.starts);
  }
}

// @tg: implements:: [[openspec:chart-document#New chart]] {confidence: partial}
/** The text of a new chart with one initial atomic state `idle`. */
export function newChart(format: Format, name?: string): string {
  if (format === "scxml") {
    const n = name !== undefined ? ` name="${name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<scxml xmlns="${SCXML_NS}" version="1.0"${n} initial="idle">\n  <state id="idle"/>\n</scxml>\n`;
  }
  const n = name !== undefined ? JSON.stringify(name) : "null";
  return `vertep: 1\nname: ${n}\ninitial: idle\nstates:\n  idle: {}\n`;
}

/** The format of a file by its name: `*.scxml`, `*.vt.yaml` / `*.vt.yml`. */
export function detectFormat(fileName: string): Format | null {
  const f = fileName.toLowerCase();
  if (f.endsWith(".scxml")) return "scxml";
  if (f.endsWith(".vt.yaml") || f.endsWith(".vt.yml")) return "yaml";
  return null;
}

export { applyPatches };
