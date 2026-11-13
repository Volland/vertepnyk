<p align="center">
  <img src="assets/logo.svg" alt="Vertepnyk: the puppeteer in the vertep under the Christmas star" width="160">
</p>

<h1 align="center">Vertepnyk</h1>

A visual designer and simulator for [vertep](https://github.com/Volland/vertep) statecharts: draw a chart, edit it, validate it and drive it with events, without writing code.

The name is the *vertepnyk* (вертепник), the puppeteer who builds the vertep box and runs the show. Vertep charts are the stage whose slots the puppets move along; vertepnyk is where you cut the slots and try the play.

Website: [volland.github.io/vertep/vertepnyk.html](https://volland.github.io/vertep/vertepnyk.html) · Article: [Two hands on one chart: co-designing with Claude Code](https://volland.github.io/vertep/articles/co-design.html)

## What it does

- **Draw and edit** SCXML (`*.scxml`) and vertep YAML (`*.vt.yaml`) charts: atomic, compound, parallel, final and history states, transitions, the datamodel and executable content.
- **Keep your file yours**: the text is the source of truth and visual edits are minimal patches, so comments and formatting survive and git diffs stay small. Layout lives inline in vertep's reserved layout namespace and never changes the chart's content hash.
- **Validate and simulate on vertep itself**: the designer runs vertep's WebAssembly interpreter, so what you see is exactly what production runs. Send events with payloads, watch the active configuration and context, and travel back and forth through the run.
- **Run where your charts live**: a VS Code extension, an Obsidian plugin (including charts in code blocks), and a standalone Electron app.

## Install

Version 0.1.0 is a preview, released on [GitHub](https://github.com/Volland/vertepnyk/releases/tag/v0.1.0). It is not listed on the VS Code Marketplace, Open VSX or Obsidian's community plugins yet.

- **VS Code** (and Cursor, VSCodium): download `vertepnyk-vscode-0.1.0.vsix`, then `code --install-extension vertepnyk-vscode-0.1.0.vsix` or **Extensions: Install from VSIX…**. Open a chart with **Open With… > Vertepnyk Designer**.
- **Obsidian**: unpack `vertepnyk-obsidian-0.1.0.zip` into `<vault>/.obsidian/plugins/` (giving `.obsidian/plugins/vertepnyk/`) and enable it under **Community plugins**.
- **macOS app**: `Vertepnyk-0.1.0-universal.dmg` (not notarized yet: open it the first time with right-click > **Open**). Windows and Linux: build from source.

## Build from source

```sh
pnpm install
pnpm build
pnpm dev                                       # web shell
pnpm --filter vertepnyk-vscode run package     # VS Code extension (.vsix)
pnpm --filter vertepnyk-electron run dist      # desktop app for this OS
```

Until `@vertep/web` and `@vertep/dm-ecma` are on npm, `pnpm-workspace.yaml` links them from a sibling vertep checkout (`../vertep-layout-ns`, branch `layout-namespace`); build them first with `npm run build` in its `bindings/js`.

## Status

M1 to M5 are implemented: all 71 requirements are implemented and verified. Known limitations:

- Vertep 0.1.3 on crates.io does not yet treat the `vl:` layout namespace as formatting, so its `vt hash` changes when layout changes; the engine bundled here already ignores layout, and the next vertep release will too.
- Automatic layout is written into the file when it first opens, so a fresh chart shows as modified, and in VS Code that undo takes two presses.
- The Obsidian plugin is verified in a simulated host, not yet in Obsidian itself; `.vt.yaml` cannot be bound by extension in Obsidian or Electron.

- Specs: [`openspec/changes/designer-core`](openspec/changes/designer-core) and [`openspec/changes/editor-hosts`](openspec/changes/editor-hosts)
- Design intent as a typed graph: [`tg.md/`](tg.md) (`tg check`, `tg cypher`)
- Roadmap: [`tg.md/roadmap.md`](tg.md/roadmap.md)

Stack: TypeScript, SolidJS, SVG, elkjs, pnpm workspaces, Vite, Vitest, Playwright, `@vertep/web`.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
