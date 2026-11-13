## 1. Host bridge

- [ ] 1.1 Define the `HostBridge` interface in package `host-bridge` and refactor `web-shell` to implement it
- [ ] 1.2 Cross-host conformance test: one scripted session (edit, validate, simulate) run against every host adapter
- [ ] 1.3 Annotate `host-bridge` implementations (Hosts own the buffer, Same behaviour in every host, Host theme is applied, Host persists view state, WebAssembly loads in every host) and a test per scenario

## 2. VS Code extension

- [ ] 2.1 Spike: load `@vertep/web`'s worker and WASM in a webview under a strict CSP
- [ ] 2.2 `CustomTextEditorProvider` for `*.scxml` and `*.vt.yaml`; patches as `WorkspaceEdit`s; default/optional editor setting
- [ ] 2.3 Text/visual toggle and side-by-side command
- [ ] 2.4 Diagnostics collection for the Problems panel with reveal
- [ ] 2.5 Commands: new chart, open designer, re-layout, sim start/reset/step, export SVG
- [ ] 2.6 Theme tokens from `--vscode-*` variables; view-state persistence
- [ ] 2.7 `@vscode/test-electron` integration tests; package with `vsce`; publish to Marketplace and Open VSX
- [ ] 2.8 Annotate `vscode-extension` implementations (Custom editor for chart files, Text and visual toggle, Native undo and save, Problems panel, Commands, VS Code distribution) and a test per scenario

## 3. Obsidian plugin

- [ ] 3.1 File view for `*.scxml` and `*.vt.yaml` via `registerView`/`registerExtensions`
- [ ] 3.2 Code-block processor for `scxml` and `vertep`; read-only canvas with an opt-in simulation panel
- [ ] 3.3 Modal designer with range-limited write-back and mismatch refusal
- [ ] 3.4 Embeds of chart files
- [ ] 3.5 Theme tokens from Obsidian CSS variables; manifest (desktop-only), versions file; submit to community plugins
- [ ] 3.6 Annotate `obsidian-plugin` implementations (Chart file view, Chart code blocks, Code-block editing writes back, Embeds and links, Obsidian distribution) and a test per scenario

## 4. Electron app

- [ ] 4.1 Main process: windows, menus, native dialogs, recent files, file associations, file watching
- [ ] 4.2 Preload `files` API; renderer = web shell build with context isolation and no Node integration
- [ ] 4.3 Tabs or windows with one simulation per document
- [ ] 4.4 electron-builder for macOS universal, Windows and Linux; release workflow on tags
- [ ] 4.5 Playwright-Electron tests
- [ ] 4.6 Annotate `electron-app` implementations (Native file handling, External changes are picked up, Multiple documents, Secure renderer, Desktop distribution) and a test per scenario

## 5. Graph and docs

- [ ] 5.1 Record H1–H5 and host platform constraints in `tg.md/` with typed edges; update host components
- [ ] 5.2 Run `tg check`, `tg ontology check` and `tg trace <capability> --gaps` for every host capability and close every gap
