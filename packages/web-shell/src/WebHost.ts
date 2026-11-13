/**
 * The web host: the buffer lives in memory; files come and go through the File System Access
 * API where the browser has it, and through `<input type=file>` and downloads where it does not.
 */
import { applyPatches, detectFormat, type Format, type Span, type TextPatch } from "@vertepnyk/core";
import type { HostBridge, HostCapabilities, HostDiagnostic, ThemeTokens, Unsubscribe, ViewState } from "@vertepnyk/host-bridge";
import type { ThemeStore } from "./theme.js";

/** A change of the buffer, for the text pane: the designer's patches, or a whole new text. */
export type BufferChange = { readonly patches: readonly TextPatch[]; readonly text: string } | { readonly patches?: undefined; readonly text: string };

interface FileHandleLike {
  readonly name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}
type Win = Window & {
  showOpenFilePicker?: (o?: unknown) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (o?: unknown) => Promise<FileHandleLike>;
};

const PICKER_TYPES = [{ description: "Statecharts", accept: { "application/xml": [".scxml"], "text/yaml": [".yaml", ".yml"] } }];

/**
 * The text without its layout (`vl:` attributes and the YAML `layout` block): automatic layout
 * writes into the file, and opening a chart must not look like editing it.
 */
export function withoutLayout(text: string, format: Format): string {
  if (format === "scxml") {
    return text.replace(/\s+vl:[\w-]+="[^"]*"/g, "").replace(/\s+xmlns:vl="[^"]*"/g, "");
  }
  return text.replace(/^layout:[^\n]*(?:\n(?![^\s#])[^\n]*)*/m, "");
}

const viewKey = (name: string): string => `vertepnyk:view:${name}`;

/** Format of a file name, or null when it is neither SCXML nor vertep YAML. */
export const formatOf = (fileName: string): Format | null => detectFormat(fileName) ?? (/\.ya?ml$/i.test(fileName) ? "yaml" : null);

export function downloadBlob(name: string, contents: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const hasFileSystemAccess = (): boolean => typeof (window as Win).showSaveFilePicker === "function";

// @tg: implements:: [[openspec:web-shell#Local file access]]
// @tg: implements:: [[openspec:web-shell#Browser host]]
export class WebHost implements HostBridge {
  readonly format: Format;
  readonly capabilities: HostCapabilities = { nativeUndo: false, textSideBySide: true, saveAs: true };
  readonly readOnly = false;
  #name: string;
  #text: string;
  #handle: FileHandleLike | undefined;
  #dirty = false;
  #baseline: string;
  #diagnostics: readonly HostDiagnostic[] = [];
  readonly #text$ = new Set<(t: string) => void>();
  readonly #buffer$ = new Set<(c: BufferChange) => void>();
  readonly #status$ = new Set<() => void>();
  readonly #reveal$ = new Set<(s: Span) => void>();
  readonly #theme: ThemeStore;
  readonly #base: string;

  constructor(init: { fileName: string; format: Format; text: string; theme: ThemeStore; handle?: FileHandleLike; base?: string }) {
    this.#name = init.fileName;
    this.format = init.format;
    this.#text = init.text;
    this.#baseline = withoutLayout(init.text, init.format);
    this.#theme = init.theme;
    this.#handle = init.handle;
    this.#base = init.base ?? import.meta.env.BASE_URL;
  }

  get fileName(): string {
    return this.#name;
  }
  get dirty(): boolean {
    return this.#dirty;
  }
  get diagnostics(): readonly HostDiagnostic[] {
    return this.#diagnostics;
  }
  getText = (): string => this.#text;

  onDidChangeText(l: (text: string) => void): Unsubscribe {
    this.#text$.add(l);
    return () => this.#text$.delete(l);
  }

  /** The text pane's edits: the buffer changes and the designer re-reads it. */
  setExternalText(text: string): void {
    if (text === this.#text) return;
    this.#text = text;
    this.#setDirty(this.#differs());
    for (const l of this.#text$) l(text);
  }

  async applyPatches(patches: readonly TextPatch[]): Promise<boolean> {
    this.#text = applyPatches(this.#text, patches);
    this.#setDirty(this.#differs());
    for (const l of this.#buffer$) l({ patches, text: this.#text });
    return true;
  }

  /** Subscribes the text pane to changes the designer makes to the buffer. */
  onDidChangeBuffer(l: (c: BufferChange) => void): Unsubscribe {
    this.#buffer$.add(l);
    return () => this.#buffer$.delete(l);
  }
  onStatus(l: () => void): Unsubscribe {
    this.#status$.add(l);
    return () => this.#status$.delete(l);
  }
  onRevealText(l: (s: Span) => void): Unsubscribe {
    this.#reveal$.add(l);
    return () => this.#reveal$.delete(l);
  }
  revealText(span: Span): void {
    for (const l of this.#reveal$) l(span);
  }
  #differs(): boolean {
    return withoutLayout(this.#text, this.format) !== this.#baseline;
  }
  #setDirty(d: boolean): void {
    if (this.#dirty === d) return;
    this.#dirty = d;
    for (const l of this.#status$) l();
  }

  // ---- files ---------------------------------------------------------------------------

  /** Saves to the file handle, or by download where the browser has no file access. */
  async save(): Promise<void> {
    if (this.#handle) {
      await this.#write(this.#handle);
    } else if (hasFileSystemAccess()) {
      await this.saveAs();
      return;
    } else {
      downloadBlob(this.#name, this.#text, this.format === "scxml" ? "application/xml" : "text/yaml");
      this.#baseline = withoutLayout(this.#text, this.format);
    }
    this.#setDirty(false);
  }

  /** Asks for a file name (save dialog, or a download under the current name). */
  async saveAs(): Promise<void> {
    const w = window as Win;
    if (!w.showSaveFilePicker) return this.save();
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: this.#name, types: PICKER_TYPES });
      await this.#write(handle);
      this.#handle = handle;
      if (formatOf(handle.name) === this.format) this.#name = handle.name;
      this.#setDirty(false);
      for (const l of this.#status$) l();
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
  }

  async #write(handle: FileHandleLike): Promise<void> {
    const w = await handle.createWritable();
    await w.write(this.#text);
    await w.close();
    this.#baseline = withoutLayout(this.#text, this.format);
  }

  async writeFile(suggestedName: string, contents: string): Promise<void> {
    downloadBlob(suggestedName, contents, suggestedName.endsWith(".svg") ? "image/svg+xml" : "text/plain");
  }

  // ---- theme, view state, assets -------------------------------------------------------

  theme = (): ThemeTokens => this.#theme.tokens();
  onThemeChange(l: (t: ThemeTokens) => void): Unsubscribe {
    return this.#theme.subscribe(l);
  }
  getViewState(): ViewState | undefined {
    try {
      const raw = localStorage.getItem(viewKey(this.#name));
      return raw ? (JSON.parse(raw) as ViewState) : undefined;
    } catch {
      return undefined;
    }
  }
  setViewState(state: ViewState): void {
    try {
      localStorage.setItem(viewKey(this.#name), JSON.stringify(state));
    } catch {
      // storage may be blocked or full
    }
  }
  publishDiagnostics(d: readonly HostDiagnostic[]): void {
    this.#diagnostics = d;
  }
  assetUrl(path: string): string {
    return `${this.#base}vertep/${path}`.replace(/\/{2,}/g, "/");
  }
  notify(message: string, severity: "info" | "warning" | "error"): void {
    (severity === "error" ? console.error : console.info)(message);
  }
}

/** Opens a file through the picker, or the hidden `<input type=file>` fallback. */
export async function pickFile(): Promise<{ fileName: string; text: string; handle?: FileHandleLike } | null> {
  const w = window as Win;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: PICKER_TYPES });
      if (!handle) return null;
      const file = await handle.getFile();
      return { fileName: file.name, text: await file.text(), handle };
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".scxml,.yaml,.yml";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { fileName: file.name, text: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
