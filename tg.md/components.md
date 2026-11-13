---
type: Component
status: planned
---
# Components

The packages of the vertepnyk pnpm workspace, what each provides, what it uses and the decisions it realizes; plus vertep's npm packages as upstream components.

## core

The host-independent chart model: SCXML and YAML syntax trees, the semantic view, edit commands, undo and layout data. No DOM.

- provides:: [[capabilities#Chart document]] {confidence: full}
- provides:: [[capabilities#Chart layout]] {confidence: partial, note: "layout data; automatic layout is in layout"}
- realizes:: [[decisions#The text file is the source of truth]]
- realizes:: [[decisions#SCXML and vertep YAML are both first-class]]
- realizes:: [[decisions#Layout lives in vertep's reserved layout namespace]]
- scheduled_in:: [[roadmap#M1 Designer core]]

## layout

Automatic layout of nested and parallel charts with elkjs in a Web Worker, incremental and cancellable.

- provides:: [[capabilities#Chart layout]] {confidence: partial, note: "automatic layout"}
- uses:: [[components#core]] {kind: required, note: "types only"}
- realizes:: [[decisions#SolidJS and SVG render the canvas]] {confidence: partial, note: "the elkjs half"}
- scheduled_in:: [[roadmap#M1 Designer core]]

## canvas

The SolidJS and SVG canvas: drawing every state kind, structural editing, navigation, theming and accessibility.

- provides:: [[capabilities#Canvas editing]] {confidence: full}
- uses:: [[components#core]] {kind: required}
- uses:: [[components#layout]] {kind: required}
- realizes:: [[decisions#SolidJS and SVG render the canvas]]
- scheduled_in:: [[roadmap#M1 Designer core]]

## inspector

Structured forms for transitions, the datamodel and executable content.

- provides:: [[capabilities#Chart inspector]] {confidence: full}
- uses:: [[components#core]] {kind: required}
- uses:: [[components#sim]] {kind: required, note: "expression checking"}
- realizes:: [[decisions#Structure on the canvas, content in the inspector]]
- scheduled_in:: [[roadmap#M1 Designer core]]

## sim

The adapter over vertep's WebAssembly interpreter: validation in a scratch system, simulation runs with journal and time travel.

- provides:: [[capabilities#Chart validation]] {confidence: full}
- provides:: [[capabilities#Chart simulation]] {confidence: full}
- uses:: [[components#core]] {kind: required}
- uses:: [[components#vertep-web]] {kind: upstream}
- uses:: [[components#vertep-dm-ecma]] {kind: upstream, note: "ECMAScript datamodel charts"}
- realizes:: [[decisions#vertep WASM is the only interpreter]]
- realizes:: [[decisions#Simulation v1 with time travel]]
- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## designer

The composed designer UI (canvas, inspector, simulation panel, diagnostics) behind the host bridge interface; what every host mounts.

- uses:: [[components#canvas]] {kind: required}
- uses:: [[components#inspector]] {kind: required}
- uses:: [[components#sim]] {kind: required}
- realizes:: [[decisions#Hosts are thin adapters over one core]]
- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## web-shell

The Vite browser page hosting the designer with a two-way text pane and an example gallery; also the Electron renderer.

- provides:: [[capabilities#Web shell]] {confidence: full}
- uses:: [[components#designer]] {kind: required}
- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## host-bridge

The interface between the designer and its host: buffer, patches, theme, view state, diagnostics, asset URLs.

- provides:: [[capabilities#Host bridge]] {confidence: full}
- realizes:: [[decisions#Hosts are thin adapters over one core]]
- scheduled_in:: [[roadmap#M3 VS Code extension]]

## vscode

The VS Code extension: CustomTextEditor for `*.scxml` and `*.vt.yaml`, commands and diagnostics.

- provides:: [[capabilities#VS Code extension]] {confidence: full}
- uses:: [[components#designer]] {kind: required}
- uses:: [[components#host-bridge]] {kind: required}
- realizes:: [[decisions#Custom editors for scxml and vt.yaml files]]
- scheduled_in:: [[roadmap#M3 VS Code extension]]

## obsidian

The Obsidian plugin: chart file view, code-block charts and embeds.

- provides:: [[capabilities#Obsidian plugin]] {confidence: full}
- uses:: [[components#designer]] {kind: required}
- uses:: [[components#host-bridge]] {kind: required}
- realizes:: [[decisions#Custom editors for scxml and vt.yaml files]]
- scheduled_in:: [[roadmap#M4 Obsidian plugin]]

## electron

The standalone desktop app: main process for native files and windows, the web shell as renderer.

- provides:: [[capabilities#Electron app]] {confidence: full}
- uses:: [[components#web-shell]] {kind: required}
- uses:: [[components#host-bridge]] {kind: required}
- realizes:: [[decisions#Hosts ship web shell, VS Code, Obsidian, Electron]]
- scheduled_in:: [[roadmap#M5 Electron app]]

## vertep-web

Upstream: vertep's `@vertep/web` npm package, the SCXML interpreter, shell and journal in WebAssembly with a TypeScript client.

- realizes:: [[decisions#Depend on published vertep packages]]
- scheduled_in:: [[roadmap#M0 Upstream prerequisites]]

## vertep-dm-ecma

Upstream: vertep's `@vertep/dm-ecma` npm package, the ECMAScript datamodel worker build.

- scheduled_in:: [[roadmap#M0 Upstream prerequisites]]

Implemented 2026-11-13: `computeLayout` (elkjs layered, hierarchical, incremental with `keepExisting`, `scope`), `createLayoutWorker` with cancellation and an in-process fallback; a 500-state chart lays out in about 1 s off the UI thread.
