/**
 * @vertepnyk/host-bridge — what a host (web shell, VS Code, Obsidian, Electron) provides to the
 * designer. The designer never imports a host API; it only talks to a `HostBridge`.
 */
import type { Format, Span, TextPatch } from "@vertepnyk/core";

/** Theme tokens as CSS custom property values; the designer maps them onto its own variables. */
export interface ThemeTokens {
  readonly kind: "light" | "dark" | "high-contrast" | "high-contrast-light";
  /** Canvas background. */
  readonly background: string;
  /** Default text. */
  readonly foreground: string;
  /** Muted text and lines. */
  readonly muted: string;
  /** State box fill and border. */
  readonly stateFill: string;
  readonly stateBorder: string;
  /** Selection and focus ring. */
  readonly accent: string;
  /** Active configuration highlight during simulation. */
  readonly active: string;
  readonly error: string;
  readonly warning: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly monoFontFamily: string;
}

/** A diagnostic as the designer publishes it to the host (Problems panel, notices). */
export interface HostDiagnostic {
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
  /** Text range when known. */
  readonly span?: Span;
  /** 1-based. */
  readonly line?: number;
  readonly column?: number;
  readonly source: "vertep" | "parse";
  readonly code?: string;
}

/** Per-document view state the host persists and restores. Opaque JSON to the host. */
export type ViewState = { readonly [key: string]: unknown };

export type Unsubscribe = () => void;

/** Capabilities a host may lack. */
export interface HostCapabilities {
  /** The host has its own undo stack for the buffer (VS Code); the designer then delegates undo. */
  readonly nativeUndo: boolean;
  /** The host can show the text editor beside the designer. */
  readonly textSideBySide: boolean;
  /** The host can open a save dialog. */
  readonly saveAs: boolean;
}

/** The contract every host implements. */
// @tg: implements:: [[openspec:host-bridge#Hosts own the buffer]]
export interface HostBridge {
  /** The document's file name (for format detection and titles). */
  readonly fileName: string;
  readonly format: Format;
  readonly capabilities: HostCapabilities;
  /** Read-only mode (e.g. Obsidian code block preview). */
  readonly readOnly: boolean;

  /** The buffer's current text. */
  getText(): string;
  /** Called when the buffer changes for any reason other than this designer's own patches. */
  onDidChangeText(listener: (text: string) => void): Unsubscribe;
  /**
   * Apply patches (computed against the text the designer last saw) to the buffer.
   * Resolves false when the host refused (the buffer changed meanwhile); the designer then re-reads.
   */
  applyPatches(patches: readonly TextPatch[], label: string): Promise<boolean>;
  /** Host-native undo/redo, used when `capabilities.nativeUndo`. */
  undo?(): void;
  redo?(): void;
  /** Persist the buffer (hosts without auto-save). */
  save(): Promise<void>;

  /** Current theme and its changes. */
  theme(): ThemeTokens;
  onThemeChange(listener: (t: ThemeTokens) => void): Unsubscribe;

  /** Per-document view state persistence. */
  getViewState(): ViewState | undefined;
  setViewState(state: ViewState): void;

  /** Show a text range in the host's text editor. */
  revealText?(span: Span): void;
  /** Publish the current diagnostics (replaces the previous set). */
  publishDiagnostics(diagnostics: readonly HostDiagnostic[]): void;
  /** Resolve a packaged asset (vertep worker, WASM, layout worker) to a URL the host can load. */
  assetUrl(path: string): string;
  /** Show a transient message. */
  notify?(message: string, severity: "info" | "warning" | "error"): void;
  /** Persist a file next to the document or via dialog (SVG export). */
  writeFile?(suggestedName: string, contents: string): Promise<void>;
}

/** Light theme defaults, used by hosts that cannot supply tokens. */
export const LIGHT_THEME: ThemeTokens = {
  kind: "light",
  background: "#fbfaf7",
  foreground: "#1f2328",
  muted: "#6e7781",
  stateFill: "#ffffff",
  stateBorder: "#8c959f",
  accent: "#0969da",
  active: "#d97706",
  error: "#cf222e",
  warning: "#9a6700",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: "13px",
  monoFontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

/** Dark theme defaults. */
export const DARK_THEME: ThemeTokens = {
  kind: "dark",
  background: "#16181d",
  foreground: "#e6edf3",
  muted: "#8b949e",
  stateFill: "#22262e",
  stateBorder: "#57606a",
  accent: "#4493f8",
  active: "#f59e0b",
  error: "#f85149",
  warning: "#d29922",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: "13px",
  monoFontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
};

/** Builds tokens from CSS variables of the host page (VS Code `--vscode-*`, Obsidian `--*`). */
export function tokensFromCss(
  read: (name: string) => string,
  map: Partial<Record<keyof Omit<ThemeTokens, "kind">, readonly string[]>>,
  kind: ThemeTokens["kind"],
): ThemeTokens {
  const base = kind === "light" || kind === "high-contrast-light" ? LIGHT_THEME : DARK_THEME;
  const out: Record<string, string> = { ...base, kind };
  for (const [key, names] of Object.entries(map) as [keyof ThemeTokens, readonly string[]][]) {
    for (const n of names) {
      const v = read(n).trim();
      if (v) {
        out[key] = v;
        break;
      }
    }
  }
  return out as unknown as ThemeTokens;
}
