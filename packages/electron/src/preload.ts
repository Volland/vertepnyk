/**
 * The only bridge between the renderer and the main process: `window.vertepnykFiles`. Context
 * isolation is on and the sandbox is on, so this script has `contextBridge` and `ipcRenderer`
 * and nothing else; every call is one IPC message the main process validates.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Channel names are repeated here (not imported from ./ipc.js) to keep this bundle free of Node built-ins.
const CH = {
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

function subscribe<T>(channel: string, cb: (payload: T) => void, onFirst?: () => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  onFirst?.();
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// @tg: implements:: [[openspec:electron-app#Secure renderer]]
const api = {
  /** Shows the open dialog; resolves the chosen document, or null. */
  open: (): Promise<unknown> => ipcRenderer.invoke(CH.open),
  /** Reads a document the user has opened before. */
  openPath: (path: string): Promise<unknown> => ipcRenderer.invoke(CH.openPath, path),
  /** Writes `text` to a document path the user has opened or saved to. */
  save: (path: string, text: string): Promise<unknown> => ipcRenderer.invoke(CH.save, path, text),
  /** Shows the save dialog; resolves the chosen path, or null. */
  saveAs: (name: string, text: string): Promise<unknown> => ipcRenderer.invoke(CH.saveAs, name, text),
  recent: (): Promise<unknown> => ipcRenderer.invoke(CH.recent),
  /** `{path, text}` when a watched file changed on disk (not through this app). */
  onFileChanged: (cb: (change: unknown) => void): (() => void) => subscribe(CH.fileChanged, cb),
  watch: (path: string): Promise<unknown> => ipcRenderer.invoke(CH.watch, path),
  unwatch: (path: string): Promise<unknown> => ipcRenderer.invoke(CH.unwatch, path),
  /** The OS (or a menu, or the command line) asks this window to show a document. Subscribing signals that the page is ready. */
  onOpenRequest: (cb: (request: unknown) => void): (() => void) => subscribe(CH.openRequest, cb, () => ipcRenderer.send(CH.ready)),
  /** Tells the main process whether there are unsaved edits (window dot, close prompt). */
  setDirty: (dirty: boolean): Promise<unknown> => ipcRenderer.invoke(CH.setDirty, dirty),
  /** A native two-button question; resolves true for the first button. */
  confirm: (options: { message: string; detail?: string; ok?: string; cancel?: string }): Promise<boolean> => ipcRenderer.invoke(CH.confirm, options),
  /** Menu commands for the document: "save", "save-as". */
  onCommand: (cb: (command: unknown) => void): (() => void) => subscribe(CH.command, cb),
};

contextBridge.exposeInMainWorld("vertepnykFiles", api);
