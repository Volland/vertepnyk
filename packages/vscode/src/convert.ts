/**
 * Pure conversions between the designer's world (offsets, host diagnostics) and VS Code's
 * (positions, ranges), kept free of `vscode` so they run in plain Node tests.
 */
import type { TextPatch } from "@vertepnyk/core";
import type { HostDiagnostic } from "@vertepnyk/host-bridge";
import type { RevealTarget } from "./protocol.js";

export interface Pos {
  readonly line: number;
  readonly character: number;
}
export interface Rng {
  readonly start: Pos;
  readonly end: Pos;
}
/** The part of `TextDocument` the conversions need. */
export interface DocLike {
  readonly version: number;
  readonly lineCount: number;
  positionAt(offset: number): Pos;
  lineLength(line: number): number;
  textLength(): number;
}

export interface TextEdit {
  readonly range: Rng;
  readonly newText: string;
}

/**
 * The edits for patches computed against the document's current text. Patches never overlap
 * and VS Code applies every edit of a `WorkspaceEdit` against the original text, so offsets
 * convert one to one.
 */
export function patchesToEdits(doc: DocLike, patches: readonly TextPatch[]): TextEdit[] {
  const len = doc.textLength();
  return patches.map((p) => {
    if (p.start < 0 || p.end < p.start || p.end > len) throw new RangeError(`patch ${p.start}-${p.end} is outside the document (${len})`);
    return { range: { start: doc.positionAt(p.start), end: doc.positionAt(p.end) }, newText: p.text };
  });
}

export type RevCheck = { readonly ok: true } | { readonly ok: false; readonly reason: "stale"; readonly current: number };

/** Patches are accepted only against the document version the webview last saw. */
export function checkRev(patchRev: number, docVersion: number): RevCheck {
  return patchRev === docVersion ? { ok: true } : { ok: false, reason: "stale", current: docVersion };
}

export interface DiagnosticData {
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
  readonly range: Rng;
  readonly source: string;
  readonly code?: string;
}

/**
 * Problems-panel entries from the designer's diagnostics. A text span wins; otherwise the
 * 1-based line and column mark the start and the range runs to the end of that line; a
 * diagnostic without a location lands on the first line.
 */
export function toDiagnostics(doc: DocLike, list: readonly HostDiagnostic[]): DiagnosticData[] {
  const clampLine = (l: number): number => Math.max(0, Math.min(doc.lineCount - 1, l));
  return list.map((d) => {
    let range: Rng;
    if (d.span && d.span.end >= d.span.start && d.span.end <= doc.textLength()) {
      range = { start: doc.positionAt(d.span.start), end: doc.positionAt(d.span.end) };
    } else if (d.line !== undefined) {
      const line = clampLine(d.line - 1);
      const col = Math.max(0, Math.min(doc.lineLength(line), (d.column ?? 1) - 1));
      range = { start: { line, character: col }, end: { line, character: Math.max(col, doc.lineLength(line)) } };
    } else {
      range = { start: { line: 0, character: 0 }, end: { line: 0, character: doc.lineLength(0) } };
    }
    return { message: d.message, severity: d.severity, range, source: d.source === "vertep" ? "vertep" : "vertepnyk", ...(d.code !== undefined ? { code: d.code } : {}) };
  });
}

/** A reveal request as a range (collapsed when only a line and column are known). */
export function revealRange(doc: DocLike, t: RevealTarget): Rng {
  if ("span" in t) return { start: doc.positionAt(t.span.start), end: doc.positionAt(t.span.end) };
  const line = Math.max(0, Math.min(doc.lineCount - 1, t.line - 1));
  const col = Math.max(0, Math.min(doc.lineLength(line), t.column - 1));
  return { start: { line, character: col }, end: { line, character: col } };
}
