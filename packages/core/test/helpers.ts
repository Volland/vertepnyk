import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "../../../fixtures");
export const SUITE = join(here, "../../../../vertep/crates/vertep-conformance/suite");

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export function fixtureNames(ext: string): string[] {
  return readdirSync(FIXTURES).filter((f) => f.endsWith(ext)).sort();
}

/** Every file under the W3C suite with one of the extensions (empty when the suite is absent). */
export function suiteFiles(...exts: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((x) => e.endsWith(x))) out.push(p);
    }
  };
  walk(SUITE);
  return out.sort();
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Line numbers (1-based, of `before`) that differ between two texts, by a simple LCS line diff. */
export function changedLines(before: string, after: string): { removed: number[]; added: number[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const removed: number[] = [];
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) removed.push(++i);
    else added.push(++j);
  }
  while (i < n) removed.push(++i);
  while (j < m) added.push(++j);
  return { removed, added };
}

/** The removed lines of `before` and added lines of `after` (contents), by line diff. */
export function diff(before: string, after: string): { removed: string[]; added: string[] } {
  const { removed, added } = changedLines(before, after);
  const a = before.split("\n");
  const b = after.split("\n");
  return { removed: removed.map((n) => a[n - 1]!), added: added.map((n) => b[n - 1]!) };
}
