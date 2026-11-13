/**
 * A chart's context (its datamodel values) as plain JSON keyed by data id, whatever the
 * datamodel: vertep sends CEL's `ctx` already decoded, while the ECMAScript build sends the
 * engine's own snapshot (`vertep-ecma/1`: globals and a heap of objects), decoded here.
 */
// @tg: implements:: [[openspec:chart-simulation#Context is shown]]

import type { JsonValue } from "@vertep/web";

/** Context values by data id. */
export type Context = Readonly<Record<string, JsonValue>>;

type EcmaValue = JsonValue | { ref: number } | { undefined?: true };
interface EcmaObject {
  kind?: string;
  props?: [string, EcmaValue, string?][];
}
interface EcmaSnapshot {
  format: string;
  declared?: string[];
  globals?: [string, EcmaValue, string?][];
  heap?: EcmaObject[];
}

function isEcma(c: unknown): c is EcmaSnapshot {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as { format?: unknown }).format === "string" &&
    (c as { format: string }).format.startsWith("vertep-ecma") &&
    Array.isArray((c as { globals?: unknown }).globals)
  );
}

function decodeEcma(s: EcmaSnapshot): Record<string, JsonValue> {
  const heap = s.heap ?? [];
  const decoding = new Set<number>();
  const value = (v: EcmaValue): JsonValue => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v as JsonValue;
    if ("ref" in v && typeof v.ref === "number") {
      const o = heap[v.ref];
      if (!o || decoding.has(v.ref)) return "[circular]";
      decoding.add(v.ref);
      try {
        const props = (o.props ?? []).filter(([k]) => !(o.kind === "array" && k === "length"));
        if (o.kind === "array") {
          const arr: JsonValue[] = [];
          for (const [k, pv] of props) {
            const i = Number(k);
            if (Number.isInteger(i) && i >= 0) arr[i] = value(pv);
          }
          return Array.from(arr, (x) => (x === undefined ? null : x));
        }
        if (o.kind === "function") return "[function]";
        const out: Record<string, JsonValue> = {};
        for (const [k, pv] of props) out[k] = value(pv);
        return out;
      } finally {
        decoding.delete(v.ref);
      }
    }
    if ("undefined" in v) return null;
    return v as JsonValue;
  };
  const declared = new Set(s.declared ?? []);
  const out: Record<string, JsonValue> = {};
  for (const [name, v] of s.globals ?? []) {
    if (declared.size === 0 || declared.has(name)) out[name] = value(v);
  }
  return out;
}

/** The context of a snapshot as plain JSON keyed by data id. */
export function normalizeContext(raw: unknown): Context {
  if (raw === null || raw === undefined) return {};
  if (isEcma(raw)) return decodeEcma(raw);
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, JsonValue>;
  return { value: raw as JsonValue };
}

/** The keys whose values differ between two contexts (added, removed or changed). */
export function changedKeys(before: Context | undefined, after: Context): string[] {
  if (!before) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !sameJson(before[k], after[k])).sort();
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
