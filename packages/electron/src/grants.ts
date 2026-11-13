/**
 * Paths the renderer may touch: those the user chose in a dialog, passed on the command line or
 * through the OS, or opened before. A compromised renderer cannot name an arbitrary file.
 */
import { normalizePath } from "./paths.js";

export class PathGrants {
  readonly #paths = new Set<string>();
  grant(path: string): void {
    this.#paths.add(normalizePath(path));
  }
  has(path: string): boolean {
    return this.#paths.has(normalizePath(path));
  }
}
