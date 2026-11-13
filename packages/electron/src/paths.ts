/**
 * Which files the app handles, and which command-line arguments name them. Pure: the main
 * process, the IPC validators and the tests all share these rules.
 */
import { basename, isAbsolute, resolve } from "node:path";

/** The extensions of a document, longest first. */
export const DOCUMENT_EXTENSIONS = [".scxml", ".vt.yaml", ".vt.yml"] as const;

export type DocumentFormat = "scxml" | "yaml";

const MAX_PATH = 4096;

/** The format of a file name, or null when it is neither SCXML nor vertep YAML (`*.vt.yaml`). */
export function documentFormat(name: string): DocumentFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".scxml")) return "scxml";
  if (lower.endsWith(".vt.yaml") || lower.endsWith(".vt.yml")) return "yaml";
  return null;
}

/** A path the main process may read or write: an absolute path to a document, nothing else. */
export function isDocumentPath(p: unknown): p is string {
  return typeof p === "string" && p.length > 0 && p.length <= MAX_PATH && !p.includes("\0") && isAbsolute(p) && documentFormat(p) !== null;
}

/** A bare file name for a save dialog: no directories, a document extension. */
export function isDocumentName(n: unknown): n is string {
  return typeof n === "string" && n.length > 0 && n.length <= 255 && !/[\\/\0]/.test(n) && documentFormat(n) !== null;
}

/** Adds the extension of `suggested` to a name the user typed without a document extension. */
export function withDocumentExtension(chosen: string, suggested: string): string {
  if (documentFormat(chosen)) return chosen;
  return `${chosen.replace(/\.(ya?ml|scxml)$/i, "")}${documentFormat(suggested) === "yaml" ? ".vt.yaml" : ".scxml"}`;
}

/** Normalised form used to compare paths (open-window lookup, grants). */
export const normalizePath = (p: string): string => resolve(p);

/** Window title for a document. */
export function titleOf(path: string | null, dirty: boolean): string {
  return `${path ? basename(path) : "untitled"}${dirty ? " ●" : ""} - Vertepnyk`;
}

/**
 * Document paths among command-line arguments. The first arguments are the executable (and,
 * running from source, the app directory); flags and anything that is not a document are skipped.
 */
export function pathsFromArgv(argv: readonly string[], opts: { cwd: string; defaultApp: boolean }): string[] {
  const out: string[] = [];
  for (const arg of argv.slice(opts.defaultApp ? 2 : 1)) {
    if (arg.startsWith("-") || arg.startsWith("--")) continue;
    if (documentFormat(arg) === null) continue;
    const abs = isAbsolute(arg) ? arg : resolve(opts.cwd, arg);
    if (isDocumentPath(abs) && !out.includes(abs)) out.push(abs);
  }
  return out;
}
