/**
 * The YAML layer: the `yaml` package's concrete syntax tree for lossless round trips and its
 * `Document` (with source ranges) for the semantic view and patch positions.
 */
import { CST, Parser, isMap, isPair, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { ChartParseFailure } from "../errors.js";
import { lineEnd } from "../text.js";

export type YNode = Node;
export type YPair = Pair<unknown, unknown>;

/** Parse a YAML text with source ranges. Throws `ChartParseFailure` on the first error. */
export function parseYamlDocument(text: string): Document.Parsed {
  const doc = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true, prettyErrors: false });
  const err = doc.errors[0];
  if (err) throw new ChartParseFailure(text, err.pos[0], err.message.split("\n")[0]!);
  return doc;
}

/** Re-print a text from its CST tokens (`CST.stringify`); identical for every input. */
export function printYamlCst(text: string): string {
  let out = "";
  for (const tok of new Parser().parse(text)) out += CST.stringify(tok);
  return out;
}

export function isNode(v: unknown): v is YNode {
  return isMap(v) || isSeq(v) || isScalar(v) || (typeof v === "object" && v !== null && "range" in v && !isPair(v));
}

/** A missing value or a null scalar. */
export function isNull(v: unknown): boolean {
  return v === null || v === undefined || (isScalar(v) && v.value === null);
}

/** A null scalar written as nothing (`key:`). */
export function isEmptyNull(v: unknown): boolean {
  return v === null || v === undefined || (isScalar(v) && v.value === null && v.range![0] === v.range![1]);
}

export function str(v: unknown): string | undefined {
  if (!isScalar(v) || v.value === null || v.value === undefined) return undefined;
  return typeof v.value === "string" ? v.value : String(v.value);
}

export function keyStr(p: YPair): string | undefined {
  return str(p.key);
}

export function getPair(map: YAMLMap, key: string): YPair | undefined {
  return (map.items as YPair[]).find((p) => keyStr(p) === key);
}

export function getVal(map: YAMLMap | null | undefined, key: string): unknown {
  return map ? getPair(map, key)?.value : undefined;
}

export function asMap(v: unknown): YAMLMap | null {
  return isMap(v) ? (v as YAMLMap) : null;
}

export function asSeq(v: unknown): YAMLSeq | null {
  return isSeq(v) ? (v as YAMLSeq) : null;
}

export function start(n: unknown): number {
  return (n as YNode).range![0];
}

/** End of a node's content (trailing whitespace and comments excluded). */
export function contentEnd(text: string, n: unknown): number {
  const node = n as YNode;
  let e: number;
  if ((isMap(node) || isSeq(node)) && !(node as YAMLMap).flow && (node as YAMLMap).items.length > 0) {
    const items = (node as YAMLMap).items as unknown[];
    const last = items[items.length - 1];
    e = isPair(last) ? pairEnd(text, last as YPair) : contentEnd(text, last);
  } else e = node.range![1];
  const s = node.range![0];
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return e;
}

/** Offset after the `:` of a pair. */
export function colonEnd(text: string, p: YPair): number {
  let i = (p.key as YNode).range![1];
  while (i < text.length && text[i] !== ":") i++;
  return i + 1;
}

/** End of a pair's content: its value's content end, or after the colon for an empty value. */
export function pairEnd(text: string, p: YPair): number {
  return isEmptyNull(p.value) ? colonEnd(text, p) : contentEnd(text, p.value);
}

/** Offset of the `- ` indicator of a block sequence item. */
export function dashOf(text: string, item: unknown): number {
  let i = start(item) - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
  return text[i] === "-" ? i : start(item);
}

/** End of the line holding `offset` (before the newline). */
export function eol(text: string, offset: number): number {
  return lineEnd(text, offset);
}
