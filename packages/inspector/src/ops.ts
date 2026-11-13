/** Pure helpers behind the inspector: no DOM, no Solid. */
import type { ChartModel, ContentItem, DataItem } from "@vertepnyk/core";

export type ItemKind = Exclude<ContentItem["kind"], "opaque">;
export const ITEM_KINDS: readonly ItemKind[] = ["assign", "raise", "send", "log", "cancel", "if", "foreach"];

export type IfItem = Extract<ContentItem, { kind: "if" }>;
export type Branch = IfItem["branches"][number];

// @tg: implements:: [[openspec:chart-inspector#Edit executable content]]
/** A fresh item of a kind, with empty fields to fill in. */
export function defaultItem(kind: ItemKind): ContentItem {
  switch (kind) {
    case "assign":
      return { kind, location: "", expr: "" };
    case "raise":
      return { kind, event: "" };
    case "send":
      return { kind, event: "" };
    case "log":
      return { kind, expr: "''" };
    case "cancel":
      return { kind, sendid: "" };
    case "if":
      return { kind, branches: [{ cond: "true", actions: [] }] };
    case "foreach":
      return { kind, array: "", item: "item", actions: [] };
  }
}

// @tg: implements:: [[openspec:chart-inspector#Edit executable content]]
/** Add/remove/move/replace on an item list; every function returns a new list and keeps the item objects (opaque ones verbatim). */
export const contentOps = {
  add(items: readonly ContentItem[], item: ContentItem | ItemKind, index: number = items.length): ContentItem[] {
    const it = typeof item === "string" ? defaultItem(item) : item;
    const at = Math.max(0, Math.min(index, items.length));
    return [...items.slice(0, at), it, ...items.slice(at)];
  },
  remove(items: readonly ContentItem[], index: number): ContentItem[] {
    return items.filter((_, i) => i !== index);
  },
  /** Move the item at `index` by `delta` positions (clamped); returns the same content when nothing moves. */
  move(items: readonly ContentItem[], index: number, delta: number): ContentItem[] {
    const to = Math.max(0, Math.min(items.length - 1, index + delta));
    if (index < 0 || index >= items.length || to === index) return [...items];
    const out = [...items];
    const [it] = out.splice(index, 1);
    out.splice(to, 0, it!);
    return out;
  },
  replace(items: readonly ContentItem[], index: number, item: ContentItem): ContentItem[] {
    return items.map((x, i) => (i === index ? item : x));
  },
};

/** `""` becomes undefined so optional attributes disappear instead of being written empty. */
export function opt(v: string): string | undefined {
  return v === "" ? undefined : v;
}

/** Add an `elseif` (before a trailing else) or an `else` branch. */
export function addBranch(item: IfItem, which: "elseif" | "else"): IfItem {
  const last = item.branches[item.branches.length - 1];
  const hasElse = last !== undefined && last.cond === undefined && item.branches.length > 1;
  if (which === "else") return hasElse ? item : { ...item, branches: [...item.branches, { actions: [] }] };
  const branch: Branch = { cond: "true", actions: [] };
  return { ...item, branches: hasElse ? [...item.branches.slice(0, -1), branch, last!] : [...item.branches, branch] };
}

export function removeBranch(item: IfItem, index: number): IfItem {
  if (index === 0) return item;
  return { ...item, branches: item.branches.filter((_, i) => i !== index) };
}

// @tg: implements:: [[openspec:chart-inspector#Event catalogue]]
/** Known event names that start with `prefix` (case-sensitive), excluding `exclude`; a prefix equal to a name still offers it. */
export function eventSuggestions(model: ChartModel, prefix: string, exclude: readonly string[] = []): string[] {
  const p = prefix.trim();
  return model.events.filter((e) => e.startsWith(p) && !exclude.includes(e));
}

/** Type input applies to typed CEL charts: CEL datamodel with YAML format, declared event types, or an already typed item. */
export function showTypeInput(model: ChartModel): boolean {
  return model.datamodel === "cel" && (model.format === "yaml" || model.eventTypes.size > 0 || model.data.some((d: DataItem) => d.type !== undefined));
}

export type SelectionView =
  | { kind: "chart" }
  | { kind: "state"; id: string }
  | { kind: "transition"; id: string }
  | { kind: "multiple"; states: number; transitions: number; total: number }
  | { kind: "missing"; id: string };

// @tg: implements:: [[openspec:chart-inspector#Inspect the selection]]
/** What the selection means for the inspector. */
export function describeSelection(model: ChartModel, selection: readonly string[]): SelectionView {
  const ids = [...new Set(selection)];
  if (ids.length === 0) return { kind: "chart" };
  if (ids.length === 1) {
    const id = ids[0]!;
    if (model.states.has(id)) return { kind: "state", id };
    if (model.transitions.has(id)) return { kind: "transition", id };
    return { kind: "missing", id };
  }
  const states = ids.filter((i) => model.states.has(i)).length;
  const transitions = ids.filter((i) => model.transitions.has(i)).length;
  return { kind: "multiple", states, transitions, total: ids.length };
}

export function summaryText(v: Extract<SelectionView, { kind: "multiple" }>): string {
  return `${v.total} items selected: ${v.states} state${v.states === 1 ? "" : "s"}, ${v.transitions} transition${v.transitions === 1 ? "" : "s"}`;
}
