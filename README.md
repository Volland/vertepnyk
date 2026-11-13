# Vertepnyk

A visual designer and simulator for [vertep](https://github.com/Volland/vertep) statecharts: draw a chart, edit it, validate it and drive it with events, without writing code.

The name is the *vertepnyk* (вертепник), the puppeteer who builds the vertep box and runs the show. Vertep charts are the stage whose slots the puppets move along; vertepnyk is where you cut the slots and try the play.

## What it will do

- **Draw and edit** SCXML (`*.scxml`) and vertep YAML (`*.vt.yaml`) charts: atomic, compound, parallel, final and history states, transitions, the datamodel and executable content.
- **Keep your file yours**: the text is the source of truth and visual edits are minimal patches, so comments and formatting survive and git diffs stay small. Layout lives inline in vertep's reserved layout namespace and never changes the chart's content hash.
- **Validate and simulate on vertep itself**: the designer runs vertep's WebAssembly interpreter, so what you see is exactly what production runs. Send events with payloads, watch the active configuration and context, and travel back and forth through the run.
- **Run where your charts live**: a VS Code extension, an Obsidian plugin (including charts in code blocks), and a standalone Electron app.

## Status

Planning. The specifications are written; implementation has not started.

- Specs: [`openspec/changes/designer-core`](openspec/changes/designer-core) and [`openspec/changes/editor-hosts`](openspec/changes/editor-hosts)
- Design intent as a typed graph: [`tg.md/`](tg.md) (`tg check`, `tg cypher`)
- Roadmap: [`tg.md/roadmap.md`](tg.md/roadmap.md)

Stack: TypeScript, SolidJS, SVG, elkjs, pnpm workspaces, Vite, Vitest, Playwright, `@vertep/web`.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
