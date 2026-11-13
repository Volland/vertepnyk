## Why

People design charts where their charts already live: developers in VS Code next to the code that runs them, knowledge workers in Obsidian notes that explain a process, and some people in a standalone app without either. `designer-core` builds one host-independent designer; this change embeds it in all three, so the same chart opens, edits and simulates identically everywhere.

## What Changes

- A host bridge: the small interface every host implements (document buffer, save, theme tokens, file reveal, settings, diagnostics sink), so the core never imports host APIs.
- A VS Code extension: a custom text editor for `*.scxml` and `*.vt.yaml` on the host's text document, a text/visual toggle, diagnostics in the Problems panel, commands and a new-chart command.
- An Obsidian plugin: a file view for `*.scxml` and `*.vt.yaml` in the vault, plus rendering of ```` ```scxml ```` and ```` ```vertep ```` code blocks in notes as charts you can simulate.
- An Electron app: a standalone desktop designer with native open/save, recent files, multiple windows and file watching.
- Ship order: VS Code, then Obsidian, then Electron (after the web shell from `designer-core`).

## Capabilities

### New Capabilities
- `host-bridge`: the contract between the designer core and a host, and the behaviour every host must provide.
- `vscode-extension`: the VS Code custom editor, commands, diagnostics and packaging.
- `obsidian-plugin`: the Obsidian file view, code-block rendering and packaging.
- `electron-app`: the standalone desktop application and its file handling and packaging.

### Modified Capabilities
<!-- none -->

## Impact

- New packages `host-bridge`, `vscode`, `obsidian`, `electron` in the vertepnyk workspace.
- Depends on all `designer-core` capabilities; WebAssembly must load inside VS Code webviews (CSP `wasm-unsafe-eval`), Obsidian (Electron renderer, mobile WebView) and Electron.
- Distribution: VS Code Marketplace and Open VSX, Obsidian community plugins, GitHub Releases for Electron builds.
- lat.md sections: `tg.md/components.md` (host components), `tg.md/constraints.md` (host platform limits), `tg.md/decisions.md` ([[decisions#Hosts are thin adapters over one core]], [[decisions#Hosts ship web shell, VS Code, Obsidian, Electron]]).
- Requirements added: `[[openspec:host-bridge#Hosts own the buffer]]` and the rest listed in each spec.
