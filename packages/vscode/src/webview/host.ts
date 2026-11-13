/**
 * The designer's `HostBridge` over the webview message channel. The extension host owns the
 * `TextDocument`; this object mirrors its text and the version (`rev`) it was read at, and
 * sends every edit as one message the host applies as one `WorkspaceEdit`.
 */
import { applyPatches, type Format, type Span, type TextPatch } from "@vertepnyk/core";
import type { HostBridge, HostCapabilities, HostDiagnostic, ThemeTokens, Unsubscribe, ViewState } from "@vertepnyk/host-bridge";
import type { HostMessage, WebviewMessage } from "../protocol.js";

export interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export interface VsCodeHostInit {
  readonly api: VsCodeApi;
  readonly fileName: string;
  readonly format: Format;
  readonly text: string;
  readonly rev: number;
  readonly viewState?: ViewState;
  /** Absolute URL of the extension's `dist/` folder as the webview sees it, with a trailing slash. */
  readonly assetBase: string;
  readonly theme: () => ThemeTokens;
  readonly onThemeChange: (l: (t: ThemeTokens) => void) => Unsubscribe;
}

// @tg: implements:: [[openspec:host-bridge#Hosts own the buffer]]
// @tg: implements:: [[openspec:host-bridge#Host persists view state]]
// @tg: implements:: [[openspec:vscode-extension#Native undo and save]]
export class VsCodeHost implements HostBridge {
  readonly fileName: string;
  readonly format: Format;
  readonly readOnly = false;
  readonly capabilities: HostCapabilities = { nativeUndo: true, textSideBySide: true, saveAs: true };
  #text: string;
  #rev: number;
  #viewState: ViewState | undefined;
  #nextId = 1;
  /** Edits are sent one at a time: each is computed against the text the previous ack confirmed. */
  #queue: Promise<unknown> = Promise.resolve();
  readonly #acks = new Map<number, (a: Extract<HostMessage, { type: "ack" }>) => void>();
  readonly #listeners = new Set<(t: string) => void>();
  readonly #init: VsCodeHostInit;
  /**
   * Set when the text last changed by VS Code's undo or redo. The designer writes the layout of
   * states that have none; doing that right after an undo of a layout step would redo it, push a
   * new undo step and drop the redo stack, so automatic layout waits until the next real edit.
   */
  #history = false;
  readonly #historyEnd = new Set<() => void>();

  constructor(init: VsCodeHostInit) {
    this.#init = init;
    this.fileName = init.fileName;
    this.format = init.format;
    this.#text = init.text;
    this.#rev = init.rev;
    this.#viewState = init.viewState ?? (init.api.getState() as { view?: ViewState } | undefined)?.view;
  }

  get rev(): number {
    return this.#rev;
  }
  getText = (): string => this.#text;

  /** Whether automatic layout is held back after an undo or redo. */
  get historyHold(): boolean {
    return this.#history;
  }
  /** Resolves when the hold ends (a real edit, or an explicit re-layout). */
  historyHoldEnded(): Promise<void> {
    return new Promise((res) => (this.#history ? this.#historyEnd.add(res) : res()));
  }
  endHistoryHold(): void {
    if (!this.#history) return;
    this.#history = false;
    const ends = [...this.#historyEnd];
    this.#historyEnd.clear();
    for (const f of ends) f();
  }

  onDidChangeText(l: (text: string) => void): Unsubscribe {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  /** Feed host messages here. */
  receive(m: HostMessage): void {
    if (m.type === "textChanged") {
      this.#rev = m.rev;
      if (m.history) this.#history = true;
      else this.endHistoryHold();
      if (m.text === this.#text) return;
      this.#text = m.text;
      for (const l of this.#listeners) l(m.text);
    } else if (m.type === "ack") {
      const done = this.#acks.get(m.id);
      this.#acks.delete(m.id);
      done?.(m);
    }
  }

  // @tg: implements:: [[openspec:vscode-extension#Native undo and save]]
  applyPatches(patches: readonly TextPatch[], label: string): Promise<boolean> {
    this.endHistoryHold();
    const run = async (): Promise<boolean> => {
      const id = this.#nextId++;
      const ack = new Promise<Extract<HostMessage, { type: "ack" }>>((res) => this.#acks.set(id, res));
      this.#init.api.postMessage({ type: "patches", id, patches, label, rev: this.#rev });
      const a = await ack;
      this.#rev = a.rev;
      if (a.ok) {
        this.#text = applyPatches(this.#text, patches);
        return true;
      }
      // refused: the buffer changed meanwhile; the designer re-reads `getText`
      if (a.text !== undefined) this.#text = a.text;
      return false;
    };
    const p = this.#queue.then(run, run);
    this.#queue = p.catch(() => undefined);
    return p;
  }

  undo(): void {
    this.#init.api.postMessage({ type: "undo" });
  }
  redo(): void {
    this.#init.api.postMessage({ type: "redo" });
  }
  async save(): Promise<void> {
    this.#init.api.postMessage({ type: "save" });
  }

  theme = (): ThemeTokens => this.#init.theme();
  onThemeChange(l: (t: ThemeTokens) => void): Unsubscribe {
    return this.#init.onThemeChange(l);
  }

  getViewState(): ViewState | undefined {
    return this.#viewState;
  }
  setViewState(state: ViewState): void {
    this.#viewState = state;
    this.#init.api.setState({ view: state });
    this.#init.api.postMessage({ type: "viewState", state });
  }

  revealText(span: Span): void {
    this.#init.api.postMessage({ type: "reveal", target: { span: { start: span.start, end: span.end } } });
  }
  publishDiagnostics(diagnostics: readonly HostDiagnostic[]): void {
    this.#init.api.postMessage({ type: "diagnostics", list: diagnostics });
  }
  assetUrl(path: string): string {
    return `${this.#init.assetBase}vertep/${path}`;
  }
  notify(message: string, severity: "info" | "warning" | "error"): void {
    this.#init.api.postMessage({ type: "notify", message, severity });
  }
  async writeFile(suggestedName: string, contents: string): Promise<void> {
    this.#init.api.postMessage({ type: "writeFile", suggestedName, contents });
  }
}
