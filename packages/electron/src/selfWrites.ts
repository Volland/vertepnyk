/**
 * The app's own writes come back as file-watcher events; remembering what was written tells them
 * from an external change.
 */
import { createHash } from "node:crypto";
import { normalizePath } from "./paths.js";

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

export class SelfWrites {
  readonly #last = new Map<string, string>();
  record(path: string, text: string): void {
    this.#last.set(normalizePath(path), digest(text));
  }
  /** True when the file's content is what this app last wrote there. */
  isOwn(path: string, text: string): boolean {
    return this.#last.get(normalizePath(path)) === digest(text);
  }
}
