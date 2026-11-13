/**
 * `HostBridge` over a text buffer that something else stores: a view's text, a note's code
 * block or a file for a read-only embed. The store decides whether a write is accepted.
 */
import { applyPatches, type Format, type Span, type TextPatch } from "@vertepnyk/core";
import type { HostBridge, HostCapabilities, HostDiagnostic, ThemeTokens, Unsubscribe, ViewState } from "@vertepnyk/host-bridge";
import type { ThemeSource } from "./theme.js";

export interface BufferHostInit {
  fileName: string;
  format: Format;
  text: string;
  readOnly?: boolean;
  theme: ThemeSource;
  /**
   * Stores `after` in place of `before`. Resolves false to refuse (the store no longer holds
   * `before`); without it the buffer is memory only.
   */
  commit?: (before: string, after: string) => boolean | Promise<boolean>;
  /** The store's text right now (to re-read after a refusal), or null when it is gone. */
  current?: () => string | null | Promise<string | null>;
  save?: () => Promise<void>;
  viewState?: { get(): ViewState | undefined; set(s: ViewState): void };
  assetUrl?: (path: string) => string;
  notify?: (message: string, severity: "info" | "warning" | "error") => void;
  writeFile?: (suggestedName: string, contents: string) => Promise<void>;
  revealText?: (span: Span) => void;
}

// @tg: implements:: [[openspec:host-bridge#Hosts own the buffer]]
export class BufferHost implements HostBridge {
  readonly fileName: string;
  readonly format: Format;
  readonly readOnly: boolean;
  readonly capabilities: HostCapabilities = { nativeUndo: false, textSideBySide: false, saveAs: false };
  #text: string;
  #diagnostics: readonly HostDiagnostic[] = [];
  #queue: Promise<unknown> = Promise.resolve();
  readonly #init: BufferHostInit;
  readonly #textListeners = new Set<(t: string) => void>();

  constructor(init: BufferHostInit) {
    this.#init = init;
    this.fileName = init.fileName;
    this.format = init.format;
    this.readOnly = init.readOnly ?? false;
    this.#text = init.text;
    if (init.notify) this.notify = init.notify;
    if (init.writeFile) this.writeFile = init.writeFile;
    if (init.revealText) this.revealText = init.revealText;
  }

  notify?: (message: string, severity: "info" | "warning" | "error") => void;
  writeFile?: (suggestedName: string, contents: string) => Promise<void>;
  revealText?: (span: Span) => void;

  get diagnostics(): readonly HostDiagnostic[] {
    return this.#diagnostics;
  }

  getText = (): string => this.#text;

  onDidChangeText(listener: (text: string) => void): Unsubscribe {
    this.#textListeners.add(listener);
    return () => this.#textListeners.delete(listener);
  }

  /** The store changed under the designer (external edit): adopt `text` and tell the designer. */
  setExternalText(text: string): void {
    if (text === this.#text) return;
    this.#text = text;
    for (const l of this.#textListeners) l(text);
  }

  /** Patches are applied one after another, each against the text the previous one left. */
  applyPatches(patches: readonly TextPatch[]): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      if (this.readOnly) return false;
      const before = this.#text;
      const after = applyPatches(before, patches);
      if (after === before) return true;
      const ok = this.#init.commit ? await this.#init.commit(before, after) : true;
      if (ok) {
        this.#text = after;
        return true;
      }
      const now = await this.#init.current?.();
      if (typeof now === "string") this.#text = now;
      return false;
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async save(): Promise<void> {
    await this.#init.save?.();
  }

  theme = (): ThemeTokens => this.#init.theme.tokens();
  onThemeChange(listener: (t: ThemeTokens) => void): Unsubscribe {
    return this.#init.theme.subscribe(listener);
  }

  #view: ViewState | undefined;
  getViewState(): ViewState | undefined {
    return this.#init.viewState ? this.#init.viewState.get() : this.#view;
  }
  setViewState(state: ViewState): void {
    if (this.#init.viewState) this.#init.viewState.set(state);
    else this.#view = state;
  }

  publishDiagnostics(diagnostics: readonly HostDiagnostic[]): void {
    this.#diagnostics = diagnostics;
  }

  assetUrl = (path: string): string => this.#init.assetUrl?.(path) ?? path;
}
