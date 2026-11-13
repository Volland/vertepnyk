/** Helpers on executable content shared by both formats. */
import type { ContentItem } from "./model.js";

/** A content item without spans, for comparing what an item means. */
function strip(item: ContentItem): unknown {
  if (item.kind === "opaque") return { kind: "opaque", source: item.source };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === "span" || v === undefined) continue;
    if (k === "actions") out[k] = (v as ContentItem[]).map(strip);
    else if (k === "branches")
      out[k] = (v as { cond?: string; actions: ContentItem[] }[]).map((b) => ({
        cond: b.cond,
        actions: b.actions.map(strip),
      }));
    else out[k] = v;
  }
  return out;
}

/** True when two items mean the same (spans ignored; opaque items compare by source). */
export function sameItem(a: ContentItem, b: ContentItem): boolean {
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Common prefix and suffix lengths of two item lists (non-overlapping). */
export function commonEnds(a: readonly ContentItem[], b: readonly ContentItem[]): [number, number] {
  let k = 0;
  while (k < a.length && k < b.length && sameItem(a[k]!, b[k]!)) k++;
  let m = 0;
  while (m < a.length - k && m < b.length - k && sameItem(a[a.length - 1 - m]!, b[b.length - 1 - m]!)) m++;
  return [k, m];
}
