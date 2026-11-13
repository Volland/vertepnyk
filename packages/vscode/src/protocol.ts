/**
 * The message protocol between the extension host and the designer webview. Pure types and
 * guards: no `vscode` import, so both sides and the unit tests share it.
 */
import type { Format, TextPatch } from "@vertepnyk/core";
import type { HostDiagnostic, ViewState } from "@vertepnyk/host-bridge";

/** Commands the host forwards into the designer. */
export type DesignerCommand = "relayout" | "simStart" | "simReset" | "simStep" | "simBack" | "exportSvg" | "fit";

export const DESIGNER_COMMANDS: readonly DesignerCommand[] = ["relayout", "simStart", "simReset", "simStep", "simBack", "exportSvg", "fit"];

/** A span of the document in offsets, or a 1-based line/column. */
export type RevealTarget = { readonly span: { readonly start: number; readonly end: number } } | { readonly line: number; readonly column: number };

/** Host to webview. */
export type HostMessage =
  | { readonly type: "init"; readonly text: string; readonly format: Format; readonly fileName: string; readonly rev: number; readonly viewState?: ViewState }
  | { readonly type: "textChanged"; readonly text: string; readonly rev: number; readonly history?: "undo" | "redo" }
  | { readonly type: "ack"; readonly id: number; readonly ok: boolean; readonly rev: number; readonly text?: string }
  | { readonly type: "cmd"; readonly name: DesignerCommand }
  | { readonly type: "debug"; readonly id: number }
  /** Test hook: run document commands as if the user edited visually. */
  | { readonly type: "debugEdit"; readonly commands: readonly unknown[] }
  /** Test hook: press the designer's own undo (which delegates to VS Code). */
  | { readonly type: "debugUndo" };

/** Webview to host. */
export type WebviewMessage =
  | { readonly type: "ready" }
  | { readonly type: "patches"; readonly id: number; readonly patches: readonly TextPatch[]; readonly label: string; readonly rev: number }
  | { readonly type: "diagnostics"; readonly list: readonly HostDiagnostic[] }
  | { readonly type: "reveal"; readonly target: RevealTarget }
  | { readonly type: "viewState"; readonly state: ViewState }
  | { readonly type: "simRunning"; readonly running: boolean }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "save" }
  | { readonly type: "writeFile"; readonly suggestedName: string; readonly contents: string }
  | { readonly type: "notify"; readonly message: string; readonly severity: "info" | "warning" | "error" }
  | { readonly type: "debugState"; readonly id: number; readonly state: WebviewStatus }
  | { readonly type: "log"; readonly level: "error" | "warn"; readonly message: string };

/** What the webview reports for the `vertepnyk.debugState` command and the integration test. */
export interface WebviewStatus {
  readonly designerMounted: boolean;
  readonly stateCount: number;
  readonly stateIds: readonly string[];
  readonly text: string;
  readonly theme: string;
  /** The simulation's active configuration, or null when none runs. */
  readonly runConfiguration: readonly string[] | null;
  /** The designer's validation status (`pending` until the vertep worker answers). */
  readonly validation: string;
  readonly cspViolations: readonly string[];
  readonly errors: readonly string[];
}

const WEBVIEW_TYPES = new Set(["ready", "patches", "diagnostics", "reveal", "viewState", "simRunning", "undo", "redo", "save", "writeFile", "notify", "debugState", "log"]);

/** Narrows an untrusted webview message to the protocol; unknown shapes are dropped. */
export function isWebviewMessage(m: unknown): m is WebviewMessage {
  if (typeof m !== "object" || m === null) return false;
  const t = (m as { type?: unknown }).type;
  if (typeof t !== "string" || !WEBVIEW_TYPES.has(t)) return false;
  const o = m as Record<string, unknown>;
  switch (t) {
    case "patches":
      return typeof o.id === "number" && typeof o.rev === "number" && typeof o.label === "string" && Array.isArray(o.patches) && o.patches.every(isPatch);
    case "diagnostics":
      return Array.isArray(o.list);
    case "reveal":
      return typeof o.target === "object" && o.target !== null;
    case "writeFile":
      return typeof o.suggestedName === "string" && typeof o.contents === "string";
    case "simRunning":
      return typeof o.running === "boolean";
    default:
      return true;
  }
}

function isPatch(p: unknown): p is TextPatch {
  const o = p as Record<string, unknown> | null;
  return typeof o === "object" && o !== null && Number.isInteger(o.start) && Number.isInteger(o.end) && typeof o.text === "string";
}

export function isHostMessage(m: unknown): m is HostMessage {
  if (typeof m !== "object" || m === null) return false;
  const t = (m as { type?: unknown }).type;
  return t === "init" || t === "textChanged" || t === "ack" || t === "cmd" || t === "debug" || t === "debugEdit" || t === "debugUndo";
}
