/**
 * The main process: windows (one document each, each with its own simulation), the native menu,
 * dialogs, recent files, OS-level opens, file watching and the `app://` protocol that serves the
 * renderer. Everything the renderer asks goes through validated IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { watch as watchFile, type FSWatcher } from "chokidar";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { APP_HOST, APP_ORIGIN, APP_SCHEME, mimeOf, resolveAppPath } from "./assets.js";
import { CLOSE_BUTTONS, afterSaveReport, choiceOf, closeNeedsPrompt, outcomeOf } from "./closing.js";
import { CSP } from "./csp.js";
import { PathGrants } from "./grants.js";
import { CH, MAX_TEXT, checkConfirm, checkDirty, checkPath, checkSave, checkSaveAs, isTrustedSenderUrl, type Checked, type Command, type OpenRequest } from "./ipc.js";
import { buildMenu } from "./menu.js";
import { documentFormat, isDocumentPath, normalizePath, pathsFromArgv, withDocumentExtension } from "./paths.js";
import { RecentFiles } from "./recent.js";
import { SelfWrites } from "./selfWrites.js";

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

interface WindowState {
  win: BrowserWindow;
  /** The document the window shows (set by the renderer through `watch`). */
  path: string | null;
  dirty: boolean;
  /** An example or untouched new document: an OS open may reuse the window. */
  pristine: boolean;
  /** What to send when the page is ready (and again if it reloads). */
  request: OpenRequest;
  watcher: FSWatcher | null;
  watching: string | null;
  forced: boolean;
  prompting: boolean;
  closeAfterSave: boolean;
}

const windows = new Map<number, WindowState>();
const grants = new PathGrants();
const selfWrites = new SelfWrites();
let recent: RecentFiles;
let rendererRoot = "";

const pendingPaths: string[] = [];
let ready = false;

// ---------------------------------------------------------------------------------------------
// documents

/** Reads a document, grants the renderer its path and records it as recent. */
async function readDocument(path: string): Promise<{ path: string; text: string }> {
  if (!isDocumentPath(path)) throw new Error("not a .scxml, .vt.yaml or .vt.yml file");
  const info = await stat(path);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > MAX_TEXT) throw new Error("the file is larger than 20 MB");
  const text = await readFile(path, "utf8");
  grants.grant(path);
  noteRecent(path);
  return { path: normalizePath(path), text };
}

function noteRecent(path: string): void {
  recent.add(path);
  app.addRecentDocument(path);
  refreshMenu();
}

function stateOf(contents: WebContents): WindowState | undefined {
  return windows.get(contents.id);
}

// @tg: implements:: [[openspec:electron-app#Native file handling]]
async function openPaths(paths: readonly string[]): Promise<void> {
  for (const p of paths) {
    try {
      const existing = [...windows.values()].find((w) => w.path !== null && normalizePath(w.path) === normalizePath(p));
      if (existing) {
        focus(existing.win);
        continue;
      }
      const doc = await readDocument(p);
      const request: OpenRequest = { kind: "open", ...doc };
      const pristine = [...windows.values()].find((w) => w.pristine && !w.dirty && w.path === null);
      if (pristine) {
        pristine.request = request;
        pristine.pristine = false;
        pristine.win.webContents.send(CH.openRequest, request);
        focus(pristine.win);
      } else {
        createWindow(request);
      }
    } catch (e) {
      dialog.showErrorBox("Could not open the file", `${p}\n\n${(e as Error).message}`);
    }
  }
}

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** OS-level open requests that name something this app does not handle are refused with a message. */
function openFromOs(path: string): void {
  if (!ready) {
    pendingPaths.push(path);
    return;
  }
  if (documentFormat(path) === null) {
    dialog.showErrorBox("Cannot open this file", `${basename(path)} is not an SCXML (.scxml) or vertep YAML (.vt.yaml, .vt.yml) file.`);
    return;
  }
  void openPaths([path]);
}

// ---------------------------------------------------------------------------------------------
// windows

function createWindow(request: OpenRequest): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Vertepnyk",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17120f" : "#fbf6ec",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  const id = win.webContents.id;
  const state: WindowState = {
    win,
    path: null,
    dirty: false,
    pristine: request.kind === "example",
    request,
    watcher: null,
    watching: null,
    forced: false,
    prompting: false,
    closeAfterSave: false,
  };
  windows.set(id, state);

  // a window never navigates away from the app, and never opens another
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-redirect", (e) => e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());

  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (!closeNeedsPrompt({ dirty: state.dirty, forced: state.forced })) return;
    e.preventDefault();
    void promptClose(state);
  });
  win.on("closed", () => {
    void state.watcher?.close();
    windows.delete(id);
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

async function promptClose(state: WindowState): Promise<void> {
  if (state.prompting) return;
  state.prompting = true;
  const name = state.path ? basename(state.path) : "this document";
  const { response } = await dialog.showMessageBox(state.win, {
    type: "warning",
    buttons: [...CLOSE_BUTTONS],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes to ${name}?`,
    detail: "Your changes will be lost if you do not save them.",
  });
  state.prompting = false;
  switch (outcomeOf(choiceOf(response))) {
    case "close":
      state.forced = true;
      state.win.close();
      break;
    case "save-then-close":
      state.closeAfterSave = true;
      send(state.win, CH.command, "save");
      break;
    case "stay":
      break;
  }
}

function send(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function focusedState(): WindowState | undefined {
  const win = BrowserWindow.getFocusedWindow();
  return win ? stateOf(win.webContents) : undefined;
}

// ---------------------------------------------------------------------------------------------
// IPC

/** Rejects calls from anything but the app's own page in the window's main frame. */
function trusted(e: IpcMainInvokeEvent): WindowState {
  const state = stateOf(e.sender);
  if (!state || !e.senderFrame || e.senderFrame !== e.sender.mainFrame || !isTrustedSenderUrl(e.senderFrame.url)) {
    throw new Error("untrusted sender");
  }
  return state;
}

function valid<T>(c: Checked<T>): T {
  if (!c.ok) throw new Error(c.error);
  return c.value;
}

function registerIpc(): void {
  ipcMain.handle(CH.open, async (e) => {
    const s = trusted(e);
    const r = await dialog.showOpenDialog(s.win, { properties: ["openFile"], filters: [{ name: "Statecharts", extensions: ["scxml", "yaml", "yml"] }] });
    const p = r.filePaths[0];
    if (r.canceled || !p) return null;
    if (!isDocumentPath(p)) {
      dialog.showErrorBox("Cannot open this file", `${basename(p)} is not an SCXML (.scxml) or vertep YAML (.vt.yaml, .vt.yml) file.`);
      return null;
    }
    return readDocument(p);
  });

  ipcMain.handle(CH.openPath, async (e, ...args) => {
    trusted(e);
    const p = valid(checkPath(args));
    if (!grants.has(p) && !recent.has(p)) throw new Error("the file was not opened through this app");
    return readDocument(p);
  });

  ipcMain.handle(CH.save, async (e, ...args) => {
    trusted(e);
    const { path, text } = valid(checkSave(args));
    if (!grants.has(path)) throw new Error("the file was not opened through this app");
    selfWrites.record(path, text);
    await writeFile(path, text, "utf8");
    noteRecent(path);
    return { path: normalizePath(path) };
  });

  ipcMain.handle(CH.saveAs, async (e, ...args) => {
    const s = trusted(e);
    const { name, text } = valid(checkSaveAs(args));
    const r = await dialog.showSaveDialog(s.win, {
      defaultPath: s.path ? join(join(s.path, ".."), name) : name,
      filters: [
        { name: documentFormat(name) === "yaml" ? "vertep YAML" : "SCXML", extensions: documentFormat(name) === "yaml" ? ["vt.yaml", "vt.yml"] : ["scxml"] },
      ],
    });
    if (r.canceled || !r.filePath) return null;
    const chosen = withDocumentExtension(r.filePath, name);
    if (!isDocumentPath(chosen)) return null;
    grants.grant(chosen);
    selfWrites.record(chosen, text);
    await writeFile(chosen, text, "utf8");
    noteRecent(chosen);
    return { path: normalizePath(chosen) };
  });

  ipcMain.handle(CH.recent, (e) => {
    trusted(e);
    return recent.list();
  });

  ipcMain.handle(CH.watch, (e, ...args) => {
    const s = trusted(e);
    const p = valid(checkPath(args));
    if (!grants.has(p)) throw new Error("the file was not opened through this app");
    unwatch(s);
    s.path = normalizePath(p);
    s.watching = s.path;
    s.pristine = false;
    const watcher = watchFile(s.path, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } });
    const onChange = async (): Promise<void> => {
      try {
        const text = await readFile(s.path!, "utf8");
        if (selfWrites.isOwn(s.path!, text)) return;
        send(s.win, CH.fileChanged, { path: s.path, text });
      } catch {
        // deleted or unreadable: keep the buffer; the user can save it again
      }
    };
    watcher.on("change", onChange).on("add", onChange);
    s.watcher = watcher;
    return true;
  });

  ipcMain.handle(CH.unwatch, (e, ...args) => {
    const s = trusted(e);
    valid(checkPath(args));
    unwatch(s);
    return true;
  });

  ipcMain.handle(CH.setDirty, (e, ...args) => {
    const s = trusted(e);
    const dirty = valid(checkDirty(args));
    s.dirty = dirty;
    if (dirty) s.pristine = false;
    if (isMac) s.win.setDocumentEdited(dirty);
    if (s.closeAfterSave) {
      s.closeAfterSave = false;
      if (afterSaveReport(dirty) === "close") {
        s.forced = true;
        s.win.close();
      }
    }
    return true;
  });

  ipcMain.handle(CH.confirm, async (e, ...args) => {
    const s = trusted(e);
    const o = valid(checkConfirm(args));
    const { response } = await dialog.showMessageBox(s.win, { type: "question", buttons: [o.ok, o.cancel], defaultId: 1, cancelId: 1, message: o.message, detail: o.detail });
    return response === 0;
  });

  // the page signals readiness (it has subscribed to open requests) by a plain message
  ipcMain.on(CH.ready, (e) => {
    const s = stateOf(e.sender);
    if (!s || !e.senderFrame || e.senderFrame !== e.sender.mainFrame || !isTrustedSenderUrl(e.senderFrame.url)) return;
    send(s.win, CH.openRequest, s.request);
  });
}

function unwatch(s: WindowState): void {
  void s.watcher?.close();
  s.watcher = null;
  s.watching = null;
}

// ---------------------------------------------------------------------------------------------
// menu, protocol, lifecycle

function command(c: Command): void {
  const s = focusedState();
  if (s) send(s.win, CH.command, c);
}

function refreshMenu(): void {
  if (!ready) return;
  Menu.setApplicationMenu(
    buildMenu({
      isMac,
      isDev,
      appName: app.name,
      newDocument: (format) => createWindow({ kind: "new", format }),
      openDialog: () => void openWithDialog(),
      openRecent: (p) => void openPaths([p]),
      clearRecent: () => {
        recent.clear();
        app.clearRecentDocuments();
        refreshMenu();
      },
      save: () => command("save"),
      saveAs: () => command("save-as"),
      setTheme: (source) => {
        nativeTheme.themeSource = source;
      },
      help: () => void shell.openExternal("https://github.com/Volland/vertepnyk"),
      recent: () => recent.list(),
    }),
  );
}

async function openWithDialog(): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow();
  const opts = { properties: ["openFile" as const], filters: [{ name: "Statecharts", extensions: ["scxml", "yaml", "yml"] }] };
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return;
  openFromOs(r.filePaths[0]);
}

function registerProtocol(): void {
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url);
    if (url.host !== APP_HOST) return new Response("forbidden", { status: 403 });
    const file = resolveAppPath(rendererRoot, url.pathname);
    if (!file) return new Response("forbidden", { status: 403 });
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        headers: { "Content-Type": mimeOf(file), "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function lockDownSession(): void {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  s.setPermissionCheckHandler(() => false);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv, cwd) => {
    const paths = pathsFromArgv(argv, { cwd, defaultApp: !!process.defaultApp });
    if (paths.length) void openPaths(paths);
    else {
      const any = BrowserWindow.getAllWindows()[0];
      if (any) focus(any);
    }
  });
  app.on("open-file", (e, path) => {
    e.preventDefault();
    openFromOs(path);
  });
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ kind: "example" });
  });

  void app.whenReady().then(async () => {
    rendererRoot = join(__dirname, "renderer");
    recent = new RecentFiles(join(app.getPath("userData"), "recent-files.json"));
    for (const p of recent.list()) app.addRecentDocument(p);
    registerProtocol();
    lockDownSession();
    registerIpc();
    ready = true;
    refreshMenu();
    const initial = [...pathsFromArgv(process.argv, { cwd: process.cwd(), defaultApp: !!process.defaultApp }), ...pendingPaths.filter((p) => isDocumentPath(p))];
    if (initial.length === 0) createWindow({ kind: "example" });
    else await openPaths([...new Set(initial)]);
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ kind: "example" });
  });
}
