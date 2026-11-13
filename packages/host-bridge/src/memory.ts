/** An in-memory host: the buffer is a string. Used by tests and by hosts that own no editor. */
import { applyPatches, type Format, type TextPatch } from "@vertepnyk/core";
import { LIGHT_THEME, type HostBridge, type HostDiagnostic, type ThemeTokens, type ViewState } from "./index.js";

export interface MemoryHost extends HostBridge {
  /** Replace the buffer as if another editor changed it. */
  setExternalText(text: string): void;
  /** The diagnostics last published. */
  readonly diagnostics: readonly HostDiagnostic[];
  setTheme(t: ThemeTokens): void;
  /** Whether `save` was called since the last edit. */
  readonly saved: boolean;
  /** Make the next `applyPatches` refuse (simulates a concurrent buffer change). */
  refuseNextPatch(): void;
}

export function createMemoryHost(init: {
  fileName: string;
  format: Format;
  text: string;
  readOnly?: boolean;
  assetBase?: string;
}): MemoryHost {
  let text = init.text;
  let theme = LIGHT_THEME;
  let diagnostics: readonly HostDiagnostic[] = [];
  let viewState: ViewState | undefined;
  let saved = true;
  let refuse = false;
  const textListeners = new Set<(t: string) => void>();
  const themeListeners = new Set<(t: ThemeTokens) => void>();
  return {
    fileName: init.fileName,
    format: init.format,
    readOnly: init.readOnly ?? false,
    capabilities: { nativeUndo: false, textSideBySide: false, saveAs: false },
    getText: () => text,
    onDidChangeText(l) {
      textListeners.add(l);
      return () => textListeners.delete(l);
    },
    async applyPatches(patches: readonly TextPatch[]) {
      if (refuse) {
        refuse = false;
        return false;
      }
      text = applyPatches(text, patches);
      saved = false;
      return true;
    },
    async save() {
      saved = true;
    },
    theme: () => theme,
    onThemeChange(l) {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    getViewState: () => viewState,
    setViewState(s) {
      viewState = s;
    },
    publishDiagnostics(d) {
      diagnostics = d;
    },
    assetUrl: (p) => `${init.assetBase ?? ""}${p}`,
    setExternalText(t) {
      text = t;
      for (const l of textListeners) l(t);
    },
    get diagnostics() {
      return diagnostics;
    },
    setTheme(t) {
      theme = t;
      for (const l of themeListeners) l(t);
    },
    get saved() {
      return saved;
    },
    refuseNextPatch() {
      refuse = true;
    },
  };
}
