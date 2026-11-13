/** The recent-files list: newest first, deduplicated, capped, kept in a JSON file. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDocumentPath, normalizePath } from "./paths.js";

export const RECENT_MAX = 10;

export class RecentFiles {
  #items: string[] = [];

  constructor(
    readonly file: string,
    readonly max: number = RECENT_MAX,
  ) {
    this.#items = this.#load();
  }

  list(): readonly string[] {
    return [...this.#items];
  }

  has(path: string): boolean {
    return this.#items.includes(normalizePath(path));
  }

  add(path: string): void {
    if (!isDocumentPath(path)) return;
    const p = normalizePath(path);
    this.#items = [p, ...this.#items.filter((x) => x !== p)].slice(0, this.max);
    this.#save();
  }

  remove(path: string): void {
    const p = normalizePath(path);
    this.#items = this.#items.filter((x) => x !== p);
    this.#save();
  }

  clear(): void {
    this.#items = [];
    this.#save();
  }

  #load(): string[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { recent?: unknown };
      if (!Array.isArray(raw.recent)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const x of raw.recent) {
        if (!isDocumentPath(x)) continue;
        const p = normalizePath(x);
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
      return out.slice(0, this.max);
    } catch {
      return [];
    }
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ recent: this.#items }, null, 2));
    } catch {
      // a read-only profile must not break the app
    }
  }
}
