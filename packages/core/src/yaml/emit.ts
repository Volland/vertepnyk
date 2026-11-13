/**
 * A small YAML emitter for inserted values: scalars are plain when safe and double-quoted
 * otherwise; collections of scalars are written in flow style, deeper ones in block style.
 */
import type { ContentItem } from "../model.js";
import { reindent } from "../text.js";

/** A value to emit. `s` is scalar text already quoted; `raw` is verbatim source at column `col`. */
export type YV =
  | { readonly s: string }
  | { readonly seq: readonly YV[] }
  | { readonly map: readonly (readonly [string, YV])[]; readonly flow?: boolean; readonly block?: boolean }
  | { readonly raw: string; readonly col: number };

const RESERVED = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE)$/;
const NUMBER = /^[-+]?(?:\.?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.Inf|\.nan|\.NaN)$/;

/** A string scalar: plain when that reads back as the same string, double-quoted otherwise. */
export function q(v: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_./-]*$/.test(v) && !RESERVED.test(v) && !NUMBER.test(v)) return v;
  return JSON.stringify(v);
}

export const S = (v: string): YV => ({ s: q(v) });
export const N = (v: number): YV => ({ s: String(Math.round(v * 100) / 100) });
export const NULL: YV = { s: "null" };

function isScalarLike(v: YV): boolean {
  return "s" in v || ("raw" in v && !v.raw.includes("\n"));
}

/** Collections of scalars (one level) fit on one line. */
export function flowable(v: YV): boolean {
  if ("s" in v) return true;
  if ("raw" in v) return !v.raw.includes("\n");
  if ("seq" in v) return v.seq.every((x) => isScalarLike(x) || ("seq" in x && x.seq.every(isScalarLike))) && flow(v).length <= 100;
  if (v.block) return false;
  return v.map.every(([, x]) => isScalarLike(x) || ("seq" in x && x.seq.every((y) => isScalarLike(y) || ("seq" in y && y.seq.every(isScalarLike))))) && flow(v).length <= 100;
}

export function flow(v: YV): string {
  if ("s" in v) return v.s;
  if ("raw" in v) return v.raw;
  if ("seq" in v) return `[${v.seq.map(flow).join(", ")}]`;
  if (v.map.length === 0) return "{}";
  return `{ ${v.map.map(([k, x]) => `${q(k)}: ${flow(x)}`).join(", ")} }`;
}

/** Text after `key:` for a key at indentation `ind`. */
export function afterKey(v: YV, ind: string, unit: string): string {
  if (flowable(v) || ("map" in v && v.map.length === 0 && !v.block) || ("seq" in v && v.seq.length === 0)) return " " + flow(v);
  if ("map" in v) return "\n" + mapLines(v.map, ind + unit, unit);
  if ("seq" in v) return "\n" + seqLines(v.seq, ind + unit, unit);
  return " " + flow(v);
}

export function mapLines(entries: readonly (readonly [string, YV])[], ind: string, unit: string): string {
  return entries.map(([k, x]) => `${ind}${q(k)}:${afterKey(x, ind, unit)}`).join("\n");
}

export function seqLines(items: readonly YV[], ind: string, unit: string): string {
  return items.map((x) => `${ind}- ${item(x, ind + "  ", unit)}`).join("\n");
}

/** A sequence item's text after `- `, with continuation lines at `ind`. */
export function item(v: YV, ind: string, unit: string): string {
  if ("s" in v) return v.s;
  if ("raw" in v) return reindent(v.raw, v.col, ind.length);
  if ("seq" in v) return flow(v);
  if (v.map.length === 0) return "{}";
  if (v.flow && flowable(v)) return flow(v);
  const [[k0, x0], ...rest] = v.map as [readonly [string, YV], ...(readonly [string, YV])[]];
  let out = `${q(k0)}:${afterKey(x0, ind, unit)}`;
  for (const [k, x] of rest) out += `\n${ind}${q(k)}:${afterKey(x, ind, unit)}`;
  return out;
}

// ------------------------------------------------------------------------------ chart values

/** The YAML value of a content item. Opaque items keep their source. */
export function contentYV(i: ContentItem, colOf: (offset: number) => number): YV {
  const m = (entries: [string, string | undefined][]): YV => ({
    map: entries.filter((e): e is [string, string] => e[1] !== undefined).map(([k, v]) => [k, S(v)] as const),
  });
  switch (i.kind) {
    case "assign":
      return { map: [["assign", m([["location", i.location], ["expr", i.expr]])]] };
    case "raise":
      return { map: [["raise", S(i.event)]] };
    case "log":
      return { map: [["log", m([["label", i.label], ["expr", i.expr]])]] };
    case "cancel":
      return { map: [["cancel", m([["sendid", i.sendid], ["sendidexpr", i.sendidexpr]])]] };
    case "send": {
      const entries: [string, YV][] = [];
      for (const [k, v] of [
        ["event", i.event],
        ["eventexpr", i.eventexpr],
        ["target", i.target],
        ["type", i.type],
        ["id", i.sendid],
        ["delay", i.delay],
      ] as const) {
        if (v !== undefined) entries.push([k, S(v)]);
      }
      if (i.params && i.params.length > 0) entries.push(["params", { map: i.params.map((p) => [p.name, S(p.expr)] as const) }]);
      return { map: [["send", { map: entries }]] };
    }
    case "if":
      return {
        map: [
          [
            "if",
            {
              seq: i.branches.map((b) => ({
                map: [
                  ...(b.cond !== undefined ? [["cond", S(b.cond)] as const] : []),
                  ["do", { seq: b.actions.map((a) => contentYV(a, colOf)) }] as const,
                ],
              })),
            },
          ],
        ],
      };
    case "foreach":
      return {
        map: [
          [
            "foreach",
            {
              map: [
                ["array", S(i.array)],
                ["item", S(i.item)],
                ...(i.index !== undefined ? [["index", S(i.index)] as const] : []),
                ...(i.actions.length > 0 ? [["do", { seq: i.actions.map((a) => contentYV(a, colOf)) }] as const] : []),
              ],
            },
          ],
        ],
      };
    case "opaque":
      return { raw: i.source, col: colOf(i.span.start) };
  }
}

/** Targets as a scalar (one) or flow list (several). */
export function targetsYV(targets: readonly string[]): YV {
  return targets.length === 1 ? S(targets[0]!) : { seq: targets.map(S) };
}
