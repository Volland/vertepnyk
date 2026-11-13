/** The native menu. Built from handlers so that `main.ts` owns the state. */
import { Menu, type MenuItemConstructorOptions } from "electron";
import { basename } from "node:path";

export interface MenuHandlers {
  readonly isMac: boolean;
  readonly isDev: boolean;
  readonly appName: string;
  newDocument(format: "scxml" | "yaml"): void;
  openDialog(): void;
  openRecent(path: string): void;
  clearRecent(): void;
  save(): void;
  saveAs(): void;
  setTheme(source: "system" | "light" | "dark"): void;
  help(): void;
  recent(): readonly string[];
}

export function buildMenu(h: MenuHandlers): Menu {
  const recent = h.recent();
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? [...recent.map((p): MenuItemConstructorOptions => ({ label: basename(p), sublabel: p, click: () => h.openRecent(p) })), { type: "separator" }, { label: "Clear Menu", click: h.clearRecent }]
    : [{ label: "No recent files", enabled: false }];

  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { label: "New SCXML", accelerator: "CmdOrCtrl+N", click: () => h.newDocument("scxml") },
      { label: "New YAML", accelerator: "CmdOrCtrl+Shift+N", click: () => h.newDocument("yaml") },
      { label: "Open…", accelerator: "CmdOrCtrl+O", click: h.openDialog },
      { label: "Open Recent", submenu: recentItems },
      { type: "separator" },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: h.save },
      { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: h.saveAs },
      { type: "separator" },
      { role: "close" },
      ...(h.isMac ? [] : [{ type: "separator" } as const, { role: "quit" } as const]),
    ],
  };
  const edit: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
  };
  const view: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      ...(h.isDev ? ([{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[]) : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      {
        label: "Theme",
        submenu: [
          { label: "Follow system", click: () => h.setTheme("system") },
          { label: "Light", click: () => h.setTheme("light") },
          { label: "Dark", click: () => h.setTheme("dark") },
        ],
      },
      { role: "togglefullscreen" },
    ],
  };
  const windowMenu: MenuItemConstructorOptions = { role: "windowMenu" };
  const help: MenuItemConstructorOptions = { role: "help", submenu: [{ label: "Vertepnyk on GitHub", click: h.help }] };
  const app: MenuItemConstructorOptions = {
    label: h.appName,
    submenu: [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
  };
  return Menu.buildFromTemplate([...(h.isMac ? [app] : []), file, edit, view, windowMenu, help]);
}
