/** IPC channels and the validation of what arrives on them. The main process trusts neither side of a message. */
import { APP_ORIGIN } from "./assets.js";
import { isDocumentName, isDocumentPath } from "./paths.js";

export const CH = {
  open: "vertepnyk:open",
  openPath: "vertepnyk:openPath",
  save: "vertepnyk:save",
  saveAs: "vertepnyk:saveAs",
  recent: "vertepnyk:recent",
  watch: "vertepnyk:watch",
  unwatch: "vertepnyk:unwatch",
  setDirty: "vertepnyk:setDirty",
  confirm: "vertepnyk:confirm",
  ready: "vertepnyk:ready",
  fileChanged: "vertepnyk:fileChanged",
  openRequest: "vertepnyk:openRequest",
  command: "vertepnyk:command",
} as const;

export const MAX_TEXT = 20 * 1024 * 1024;

/** What the renderer is told to show. */
export type OpenRequest =
  | { readonly kind: "open"; readonly path: string; readonly text: string }
  | { readonly kind: "new"; readonly format: "scxml" | "yaml" }
  | { readonly kind: "example" };

export type Command = "save" | "save-as";

export const FILES_API_KEYS = ["open", "openPath", "save", "saveAs", "recent", "onFileChanged", "watch", "unwatch", "onOpenRequest", "setDirty", "confirm", "onCommand"] as const;

/** Only frames of the app's own origin may call the main process. */
export function isTrustedSenderUrl(url: unknown): boolean {
  return typeof url === "string" && (url === `${APP_ORIGIN}/` || url.startsWith(`${APP_ORIGIN}/`));
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isText = (t: unknown): t is string => typeof t === "string" && t.length <= MAX_TEXT;

export function checkPath(args: readonly unknown[]): Checked<string> {
  const [p] = args;
  return args.length === 1 && isDocumentPath(p) ? { ok: true, value: p } : bad("not a .scxml, .vt.yaml or .vt.yml file path");
}

export function checkSave(args: readonly unknown[]): Checked<{ path: string; text: string }> {
  const [p, t] = args;
  if (args.length !== 2) return bad("save takes a path and the text");
  if (!isDocumentPath(p)) return bad("not a .scxml, .vt.yaml or .vt.yml file path");
  if (!isText(t)) return bad("the text must be a string of at most 20 MB");
  return { ok: true, value: { path: p, text: t } };
}

export function checkSaveAs(args: readonly unknown[]): Checked<{ name: string; text: string }> {
  const [n, t] = args;
  if (args.length !== 2) return bad("saveAs takes a file name and the text");
  if (!isDocumentName(n)) return bad("not a .scxml, .vt.yaml or .vt.yml file name");
  if (!isText(t)) return bad("the text must be a string of at most 20 MB");
  return { ok: true, value: { name: n, text: t } };
}

export function checkDirty(args: readonly unknown[]): Checked<boolean> {
  return args.length === 1 && typeof args[0] === "boolean" ? { ok: true, value: args[0] } : bad("setDirty takes a boolean");
}

export interface ConfirmArgs {
  readonly message: string;
  readonly detail: string;
  readonly ok: string;
  readonly cancel: string;
}

const short = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;

export function checkConfirm(args: readonly unknown[]): Checked<ConfirmArgs> {
  const [o] = args;
  if (args.length !== 1 || typeof o !== "object" || o === null) return bad("confirm takes an options object");
  const { message, detail = "", ok = "OK", cancel = "Cancel" } = o as Record<string, unknown>;
  if (!short(message, 300) || typeof detail !== "string" || detail.length > 600 || !short(ok, 40) || !short(cancel, 40)) return bad("invalid confirm options");
  return { ok: true, value: { message, detail, ok, cancel } };
}
