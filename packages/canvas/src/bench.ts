/**
 * Chart generators for benchmarks and tests: a deep and wide chart of `n` states and `m`
 * transitions as SCXML text. Deterministic; every transition target exists.
 */
const NS = "http://www.w3.org/2005/07/scxml";

export interface GenerateOptions {
  /** Children per compound state (default 6). */
  readonly branching?: number;
}

export function generateChart(n: number, m: number, opts: GenerateOptions = {}): string {
  const count = Math.max(1, Math.floor(n));
  const b = Math.max(2, opts.branching ?? 6);
  const roots = Math.max(1, Math.ceil(count / 50));
  const parentOf = (i: number): number => (i < roots ? -1 : Math.floor((i - roots) / b));
  const children: number[][] = Array.from({ length: count }, () => []);
  const top: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = parentOf(i);
    if (p < 0) top.push(i);
    else children[p]!.push(i);
  }
  const trs: string[][] = Array.from({ length: count }, () => []);
  for (let k = 0; k < Math.max(0, m); k++) {
    const s = (k * 7919) % count;
    const t = (k * 104729 + 13) % count;
    const cond = k % 5 === 0 ? ` cond="n &gt; ${k % 10}"` : "";
    trs[s]!.push(`<transition event="e${k % 50}"${cond} target="s${t}"/>`);
  }
  const out: string[] = [];
  const emit = (i: number, depth: number): void => {
    const pad = "  ".repeat(depth);
    const kids = children[i]!;
    const own = trs[i]!;
    if (kids.length === 0 && own.length === 0) {
      out.push(`${pad}<state id="s${i}"/>`);
      return;
    }
    const initial = kids.length > 0 ? ` initial="s${kids[0]}"` : "";
    out.push(`${pad}<state id="s${i}"${initial}>`);
    for (const t of own) out.push(`${pad}  ${t}`);
    for (const c of kids) emit(c, depth + 1);
    out.push(`${pad}</state>`);
  };
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<scxml xmlns="${NS}" version="1.0" name="generated" initial="s${top[0]}">`);
  for (const t of top) emit(t, 1);
  out.push(`</scxml>`, "");
  return out.join("\n");
}
