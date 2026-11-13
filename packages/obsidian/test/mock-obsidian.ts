/**
 * A minimal stand-in for the `obsidian` module, aliased in by vitest. It models only what the
 * plugin touches: components with load/unload, a vault with `process`, editors with
 * `getRange/replaceRange`, markdown views and the workspace that finds them, modals, notices and
 * the DOM helpers Obsidian adds to `HTMLElement`. Behaviour follows Obsidian's documented API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- DOM helpers Obsidian adds to every element -----------------------------------------

interface DomInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  type?: string;
  value?: string;
}
function applyInfo(el: HTMLElement, o?: DomInfo | string): void {
  if (typeof o === "string") {
    el.className = o;
    return;
  }
  if (!o) return;
  if (o.cls) for (const c of Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/)) if (c) el.classList.add(c);
  if (o.text !== undefined) el.textContent = o.text;
  if (o.title) el.title = o.title;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null) el.setAttribute(k, String(v));
}
const proto = HTMLElement.prototype as any;
proto.createEl = function (tag: string, o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
  const el = document.createElement(tag);
  applyInfo(el, o);
  this.appendChild(el);
  cb?.(el);
  return el;
};
proto.createDiv = function (o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
  return this.createEl("div", o, cb);
};
proto.createSpan = function (o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
  return this.createEl("span", o, cb);
};
proto.empty = function () {
  while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (...c: string[]) {
  this.classList.add(...c);
};
proto.removeClass = function (...c: string[]) {
  this.classList.remove(...c);
};
proto.toggleClass = function (c: string, on: boolean) {
  this.classList.toggle(c, on);
};
proto.setText = function (t: string) {
  this.textContent = t;
};

// ---- components and events --------------------------------------------------------------

export class Component {
  _loaded = false;
  _children: Component[] = [];
  _cleanups: (() => void)[] = [];
  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const c of this._children) c.load();
  }
  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of [...this._children]) c.unload();
    for (const f of this._cleanups.splice(0)) f();
    this.onunload();
  }
  onload(): void {}
  onunload(): void {}
  addChild<T extends Component>(c: T): T {
    this._children.push(c);
    if (this._loaded) c.load();
    return c;
  }
  removeChild<T extends Component>(c: T): T {
    this._children = this._children.filter((x) => x !== c);
    c.unload();
    return c;
  }
  register(cb: () => any): void {
    this._cleanups.push(cb);
  }
  registerEvent(ref: EventRef): void {
    this._cleanups.push(() => ref.off());
  }
}

export interface EventRef {
  off(): void;
}
export class Events {
  _handlers = new Map<string, Set<(...a: any[]) => any>>();
  on(name: string, cb: (...a: any[]) => any): EventRef {
    const set = this._handlers.get(name) ?? new Set();
    set.add(cb);
    this._handlers.set(name, set);
    return { off: () => set.delete(cb) };
  }
  trigger(name: string, ...args: any[]): void {
    for (const cb of [...(this._handlers.get(name) ?? [])]) cb(...args);
  }
}

export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
}

// ---- files -------------------------------------------------------------------------------

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === "/";
  }
}
export class TFile extends TAbstractFile {
  extension = "";
  basename = "";
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/";
}

export class FakeVault extends Events {
  configDir = ".obsidian";
  files = new Map<string, string>();
  tfiles = new Map<string, TFile>();
  binaries = new Map<string, ArrayBuffer>();
  root = Object.assign(new TFolder(), { path: "/", name: "" });
  written = new Map<string, string>();
  adapter = {
    readBinary: async (path: string): Promise<ArrayBuffer> => {
      const b = this.binaries.get(path);
      if (!b) throw new Error(`ENOENT ${path}`);
      return b;
    },
    getResourcePath: (path: string): string => `app://local/${path}?1`,
    write: async (path: string, data: string): Promise<void> => {
      this.written.set(path, data);
    },
  };
  /** Adds a file (test setup; no event). */
  add(path: string, data: string): TFile {
    this.files.set(path, data);
    const f = new TFile();
    f.path = path;
    f.name = path.split("/").pop()!;
    f.extension = f.name.split(".").pop()!;
    f.basename = f.name.slice(0, f.name.length - f.extension.length - 1);
    f.parent = this.root;
    this.tfiles.set(path, f);
    return f;
  }
  getRoot(): TFolder {
    return this.root;
  }
  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.tfiles.get(path) ?? null;
  }
  async read(f: TFile): Promise<string> {
    return this.files.get(f.path)!;
  }
  async cachedRead(f: TFile): Promise<string> {
    return this.files.get(f.path)!;
  }
  async modify(f: TFile, data: string): Promise<void> {
    this.files.set(f.path, data);
    this.trigger("modify", f);
  }
  async create(path: string, data: string): Promise<TFile> {
    const f = this.add(path, data);
    this.trigger("create", f);
    return f;
  }
  /** Atomic read-modify-write, as the real `Vault.process`. */
  async process(f: TFile, fn: (data: string) => string): Promise<string> {
    const next = fn(this.files.get(f.path)!);
    if (next !== this.files.get(f.path)) await this.modify(f, next);
    return next;
  }
}

// ---- editor and views --------------------------------------------------------------------

export interface EditorPosition {
  line: number;
  ch: number;
}
export class Editor {
  value: string;
  constructor(value = "") {
    this.value = value;
  }
  #offset(p: EditorPosition): number {
    const lines = this.value.split("\n");
    let off = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) off += lines[i]!.length + 1;
    return Math.min(this.value.length, off + (p.line >= lines.length ? 0 : p.ch));
  }
  getValue(): string {
    return this.value;
  }
  setValue(v: string): void {
    this.value = v;
  }
  getRange(from: EditorPosition, to: EditorPosition): string {
    return this.value.slice(this.#offset(from), this.#offset(to));
  }
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void {
    const a = this.#offset(from);
    const b = to ? this.#offset(to) : a;
    this.value = this.value.slice(0, a) + text + this.value.slice(b);
  }
  lineCount(): number {
    return this.value.split("\n").length;
  }
}

export class WorkspaceLeaf extends Events {
  view: any = null;
  opened: TFile | null = null;
  viewState: any = null;
  async openFile(f: TFile): Promise<void> {
    this.opened = f;
  }
  async setViewState(s: any): Promise<void> {
    this.viewState = s;
  }
}

export class View extends Component {
  app: any;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement = document.createElement("div");
  contentEl: HTMLElement = this.containerEl.createDiv();
  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    leaf.view = this;
  }
  getViewType(): string {
    return "";
  }
  getState(): any {
    return {};
  }
  async setState(_state: any, _result: any): Promise<void> {}
  async onClose(): Promise<void> {}
  addAction(): HTMLElement {
    return document.createElement("div");
  }
}
export class ItemView extends View {}
export class EditableFileView extends ItemView {
  file: TFile | null = null;
}
export class TextFileView extends EditableFileView {
  data = "";
  saveRequests = 0;
  saved: string[] = [];
  requestSave = (): void => {
    this.saveRequests++;
  };
  /** Obsidian saves `getViewData()` to the file. */
  async save(): Promise<void> {
    const f = this.file;
    if (!f) return;
    const data = this.getViewData();
    this.saved.push(data);
    await (this.app as any).vault.modify(f, data);
  }
  async onLoadFile(file: TFile): Promise<void> {
    this.file = file;
    const data = await (this.app as any).vault.read(file);
    this.setViewData(data, true);
  }
  getViewData(): string {
    return this.data;
  }
  setViewData(_data: string, _clear: boolean): void {}
  clear(): void {}
  getState(): any {
    return { file: this.file?.path };
  }
}

export class MarkdownView extends TextFileView {
  editor = new Editor();
  mode: "source" | "preview" = "source";
  getViewType(): string {
    return "markdown";
  }
  getMode(): "source" | "preview" {
    return this.mode;
  }
}

export class Workspace extends Events {
  leaves: WorkspaceLeaf[] = [];
  activeView: any = null;
  activeFile: TFile | null = null;
  openedLeaves: WorkspaceLeaf[] = [];
  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves.filter((l) => l.view?.getViewType() === type);
  }
  getActiveViewOfType<T>(cls: new (...a: any[]) => T): T | null {
    return this.activeView instanceof cls ? this.activeView : null;
  }
  getActiveFile(): TFile | null {
    return this.activeFile;
  }
  getLeaf(_new?: any): WorkspaceLeaf {
    const l = new WorkspaceLeaf();
    this.openedLeaves.push(l);
    return l;
  }
}

export class MetadataCache extends Events {
  constructor(private vault: FakeVault) {
    super();
  }
  /** `[[name]]` resolves to the file with that name or path anywhere in the vault. */
  getFirstLinkpathDest(linkpath: string, _source: string): TFile | null {
    for (const [p, f] of this.vault.tfiles) if (p === linkpath || p.endsWith(`/${linkpath}`)) return f;
    return null;
  }
}

export class App {
  vault = new FakeVault();
  workspace = new Workspace();
  metadataCache = new MetadataCache(this.vault);
}

// ---- plugin, modal, notice, settings ----------------------------------------------------

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  dir?: string;
  isDesktopOnly?: boolean;
}

export class Plugin extends Component {
  app: App;
  manifest: PluginManifest;
  views = new Map<string, (leaf: WorkspaceLeaf) => View>();
  extensions = new Map<string, string>();
  codeBlocks = new Map<string, (source: string, el: HTMLElement, ctx: any) => any>();
  postProcessors: ((el: HTMLElement, ctx: any) => any)[] = [];
  commands = new Map<string, any>();
  settingTabs: any[] = [];
  stored: unknown = null;
  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData(): Promise<unknown> {
    return this.stored;
  }
  async saveData(d: unknown): Promise<void> {
    this.stored = JSON.parse(JSON.stringify(d));
  }
  registerView(type: string, creator: (leaf: WorkspaceLeaf) => View): void {
    this.views.set(type, creator);
  }
  registerExtensions(exts: string[], type: string): void {
    for (const e of exts) {
      if (this.extensions.has(e)) throw new Error(`Attempting to register an existing view extension "${e}"`);
      this.extensions.set(e, type);
    }
  }
  registerMarkdownCodeBlockProcessor(lang: string, fn: (source: string, el: HTMLElement, ctx: any) => any): void {
    this.codeBlocks.set(lang, fn);
  }
  registerMarkdownPostProcessor(fn: (el: HTMLElement, ctx: any) => any): void {
    this.postProcessors.push(fn);
  }
  addCommand(c: any): void {
    this.commands.set(c.id, c);
  }
  addSettingTab(t: any): void {
    this.settingTabs.push(t);
  }
}

export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(public app: App, public plugin: Plugin) {}
}
class Chain {
  setValue(_v: any): this {
    return this;
  }
  onChange(_f: any): this {
    return this;
  }
}
export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(_n: string): this {
    return this;
  }
  setDesc(_n: string): this {
    return this;
  }
  addToggle(f: (t: Chain) => void): this {
    f(new Chain());
    return this;
  }
  addText(f: (t: Chain) => void): this {
    f(new Chain());
    return this;
  }
}

export class Modal {
  contentEl = document.createElement("div");
  modalEl = document.createElement("div");
  opened = false;
  constructor(public app: App) {}
  open(): void {
    this.opened = true;
    void this.onOpen();
  }
  close(): void {
    this.opened = false;
    this.onClose();
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export type MarkdownPostProcessorContext = any;
export type ViewStateResult = any;
export type MarkdownViewModeType = "source" | "preview";
