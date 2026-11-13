# vertepnyk-electron

Desktop app: the web shell's designer and text pane in Electron, with native file handling.

- `src/main.ts` main process (windows, menu, dialogs, recent files, watching, `app://` protocol); `src/preload.ts` is the only bridge (`window.vertepnykFiles`); `renderer/` is the page.
- The renderer is served from `app://vertepnyk/` (a privileged custom scheme), not `file://`: Chromium refuses module workers and WebAssembly `fetch` from `file://`.
- Build: `pnpm --filter vertepnyk-electron run build`; run: `pnpm --filter vertepnyk-electron run start`; e2e: `run test:e2e`; unpacked package: `run pack` (set `CSC_IDENTITY_AUTO_DISCOVERY=false`).
- Set `ELECTRON_RUN_AS_NODE` nowhere: it makes Electron behave as plain Node.
- File associations: `.scxml` is registered by extension. OS associations work by last extension, so `*.vt.yaml` / `*.vt.yml` are registered as an alternate editor for `.yaml` / `.yml` (use "Open With"); the app opens only names ending in `.scxml`, `.vt.yaml` or `.vt.yml` and refuses others with a message.
