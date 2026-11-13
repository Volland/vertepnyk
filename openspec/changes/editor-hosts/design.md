## Context

See proposal.md. `designer-core` delivers a `designer` package that mounts into a DOM element and talks to its host only through the host bridge. The three hosts differ in buffer ownership, theming, packaging and security:

- VS Code: webviews with a strict CSP; `CustomTextEditorProvider` keeps the `TextDocument` as the buffer; theme via `--vscode-*` CSS variables; WebAssembly needs `'wasm-unsafe-eval'` in the CSP.
- Obsidian: plugins run in the Electron renderer with DOM access; `registerView` + `registerExtensions` for file types; `registerMarkdownCodeBlockProcessor` for code blocks; theme via Obsidian CSS variables; community plugins may not load remote code.
- Electron: we control the shell; renderer must use `contextIsolation: true`, `nodeIntegration: false`, a preload bridge.

## Goals / Non-Goals

**Goals:** identical behaviour across hosts; native buffer semantics in each; offline operation.

**Non-Goals:** VS Code for the Web (vscode.dev) in v1; Obsidian mobile in v1; auto-update for the Electron app in v1; JetBrains or other hosts.

## Decisions

### H1. Hosts are thin adapters over one core
A `HostBridge` interface: `getText()`, `onDidChangeText`, `applyPatch(patches)`, `save()`, `theme()`/`onThemeChange`, `viewState` get/set, `reveal(range)`, `publishDiagnostics(list)`, `assetUrl(path)` for the WASM worker. Each host package implements it in under ~500 lines; all UI lives in `designer`.
- Rejected: per-host UI forks (drift); a local web server serving the designer to every host (ports, security, offline problems).

### H2. VS Code uses a CustomTextEditor, not a CustomEditor
`CustomTextEditorProvider` reuses VS Code's `TextDocument`, so undo, save, hot exit, git diff and the text editor side-by-side come free. Patches become `WorkspaceEdit`s. The webview is retained when hidden (`retainContextWhenHidden`) only while a simulation runs, to bound memory.
- Rejected: `CustomEditorProvider` with our own document model (reimplements undo/backup/save).

### H3. Obsidian renders code blocks with a lighter mount
Code blocks mount the canvas read-only with an opt-in simulation panel; editing opens a modal designer whose patches are written back via `editor.replaceRange` (live preview) or `vault.process` (reading mode) limited to the block's range.
- Rejected: full designer inline in every code block (heavy for notes with many charts).

### H4. Electron shares the web shell
The Electron renderer is the web shell build with a preload `files` API replacing File System Access; the main process handles dialogs, recent files, file associations and watching (chokidar). Packaged with electron-builder.
- Rejected: Tauri (WebKit on macOS/Linux makes rendering and WASM behaviour differ from the other hosts, which run Chromium); the decision favours one engine for "same behaviour in every host".

### H5. Ship order: web shell, VS Code, Obsidian, Electron
Each host is a milestone after the core milestone; the host bridge is extracted while building VS Code and proven by Obsidian.

## Risks / Trade-offs

- [WASM in VS Code webviews requires CSP `'wasm-unsafe-eval'` and worker URLs from `asWebviewUri`] → spike in the first VS Code task.
- [Obsidian mobile WebView memory with a 1.2 MB WASM] → desktop-only until tested.
- [Code-block write-back can clobber concurrent typing] → apply patches against the block's current text and refuse on mismatch.
- [Electron app size (~100 MB)] → accepted for a standalone app; the editors are the lightweight path.

## Migration Plan

None (new packages).
