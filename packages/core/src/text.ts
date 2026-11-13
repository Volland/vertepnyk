/**
 * Text utilities shared by both formats: patch application and composition, offset/line
 * conversion and indentation helpers.
 */
import type { Position, TextPatch } from "./model.js";

/** Sort patches by start; zero-width patches at the same offset keep their given order. */
function sorted(patches: readonly TextPatch[]): TextPatch[] {
  return patches
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.start - b.p.start || a.p.end - b.p.end || a.i - b.i)
    .map((x) => x.p);
}

/** Apply non-overlapping patches (all relative to `text`) and return the new text. */
export function applyPatches(text: string, patches: readonly TextPatch[]): string {
  if (patches.length === 0) return text;
  const ps = sorted(patches);
  let out = "";
  let pos = 0;
  for (const p of ps) {
    if (p.start < pos || p.end < p.start || p.end > text.length) {
      throw new RangeError(`overlapping or out-of-range patch [${p.start}, ${p.end})`);
    }
    out += text.slice(pos, p.start) + p.text;
    pos = p.end;
  }
  return out + text.slice(pos);
}

/**
 * Compose `next` (patches against the text produced by `base`) onto `base` (patches against an
 * original text), giving patches against the original text. Touching patches merge.
 */
export function composePatches(
  original: string,
  base: readonly TextPatch[],
  next: readonly TextPatch[],
): TextPatch[] {
  let acc = sorted(base).filter((p) => !(p.start === p.end && p.text === ""));
  let current = applyPatches(original, acc);
  // Apply the next patches from the last to the first so that earlier offsets stay valid.
  const ns = sorted(next);
  for (let k = ns.length - 1; k >= 0; k--) {
    const q = ns[k]!;
    acc = composeOne(acc, current, q);
    current = current.slice(0, q.start) + q.text + current.slice(q.end);
  }
  return acc.filter((p) => !(p.start === p.end && p.text === ""));
}

function composeOne(acc: TextPatch[], current: string, q: TextPatch): TextPatch[] {
  // C-ranges of the accumulated patches.
  let delta = 0;
  const cr: { p: TextPatch; cs: number; ce: number; deltaBefore: number }[] = [];
  for (const p of acc) {
    const cs = p.start + delta;
    const ce = cs + p.text.length;
    cr.push({ p, cs, ce, deltaBefore: delta });
    delta += p.text.length - (p.end - p.start);
  }
  const touched = cr.filter((r) => r.cs <= q.end && r.ce >= q.start);
  if (touched.length === 0) {
    // Find the shift at q.start.
    let shift = 0;
    for (const r of cr) if (r.ce <= q.start) shift = r.deltaBefore + r.p.text.length - (r.p.end - r.p.start);
    const np: TextPatch = { start: q.start - shift, end: q.end - shift, text: q.text };
    const out = [...acc, np];
    return sorted(out);
  }
  const first = touched[0]!;
  const last = touched[touched.length - 1]!;
  const cs = Math.min(q.start, first.cs);
  const ce = Math.max(q.end, last.ce);
  const os = cs - first.deltaBefore;
  let innerDelta = 0;
  for (const r of touched) innerDelta += r.p.text.length - (r.p.end - r.p.start);
  const oe = os + (ce - cs) - innerDelta;
  const text = current.slice(cs, q.start) + q.text + current.slice(q.end, ce);
  const out = acc.filter((p) => !touched.some((r) => r.p === p));
  out.push({ start: os, end: oe, text });
  return sorted(out);
}

/** Patches that turn `after` (the result of `patches` on `before`) back into `before`. */
export function invertPatches(before: string, patches: readonly TextPatch[]): TextPatch[] {
  const out: TextPatch[] = [];
  let delta = 0;
  for (const p of sorted(patches)) {
    const s = p.start + delta;
    out.push({ start: s, end: s + p.text.length, text: before.slice(p.start, p.end) });
    delta += p.text.length - (p.end - p.start);
  }
  return out;
}

/** Map an offset of the original text through patches; null when it falls inside a replaced span. */
export function mapOffset(offset: number, patches: readonly TextPatch[]): number | null {
  let delta = 0;
  for (const p of sorted(patches)) {
    if (p.end < offset || (p.end === offset && p.start < offset) || (p.start === offset && p.end === offset)) {
      delta += p.text.length - (p.end - p.start);
    } else if (p.start < offset || (p.start === offset && p.end > offset)) {
      return null;
    }
  }
  return offset + delta;
}

/** Offsets of the first character of every line. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line and column (UTF-16 units) of an offset. */
export function positionAt(text: string, offset: number, starts: readonly number[] = lineStarts(text)): Position {
  const o = Math.max(0, Math.min(offset, text.length));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= o) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: o - starts[lo]! + 1 };
}

/** Offset of the start of the line containing `offset`. */
export function lineStart(text: string, offset: number): number {
  const i = text.lastIndexOf("\n", offset - 1);
  return i + 1;
}

/** Offset of the line break ending the line containing `offset` (or text length). */
export function lineEnd(text: string, offset: number): number {
  const i = text.indexOf("\n", offset);
  return i < 0 ? text.length : i;
}

/** Leading whitespace of the line containing `offset`. */
export function indentAt(text: string, offset: number): string {
  const s = lineStart(text, offset);
  let e = s;
  while (e < text.length && (text[e] === " " || text[e] === "\t")) e++;
  return text.slice(s, e);
}

/** True when only spaces/tabs precede `offset` on its line. */
export function firstOnLine(text: string, offset: number): boolean {
  return /^[ \t]*$/.test(text.slice(lineStart(text, offset), offset));
}

/** True when only spaces/tabs follow `offset` up to the end of its line. */
export function lastOnLine(text: string, offset: number): boolean {
  return /^[ \t]*\r?$/.test(text.slice(offset, lineEnd(text, offset)));
}

/** Column (0-based) of an offset within its line. */
export function columnOf(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

/**
 * Shift lines 2..n of a multi-line snippet from indentation column `from` to `to`. Lines that
 * have less indentation than `from` are left alone.
 */
export function reindent(snippet: string, from: number, to: number): string {
  if (from === to || !snippet.includes("\n")) return snippet;
  const lines = snippet.split("\n");
  return lines
    .map((line, i) => {
      if (i === 0) return line;
      if (to > from) return line.length === 0 ? line : " ".repeat(to - from) + line;
      const strip = from - to;
      return /^ *$/.test(line.slice(0, strip)) ? line.slice(Math.min(strip, line.length)) : line;
    })
    .join("\n");
}
