---
type: Decision
status: accepted
date: 2026-11-13
openspec: [chart-document, chart-layout, canvas-editing, chart-inspector, chart-validation, chart-simulation, web-shell, host-bridge, vscode-extension, obsidian-plugin, electron-app]
---
# Decisions

Choices made in the 2026-11-13 design session (grilling) for vertepnyk, with the alternatives rejected and the reasons, as typed edges to constraints and concepts.

## vertep WASM is the only interpreter

Simulation and validation run on vertep's WebAssembly interpreter (`@vertep/web`); the designer never computes a transition itself.

- motivated_by:: [[constraints#vertep semantics are the reference]] {weight: primary}
- motivated_by:: [[constraints#vertep WASM API surface]] {weight: secondary}

Rejected: a TypeScript SCXML interpreter (semantic drift, duplicate conformance work), XState's runtime (different semantics, no full datamodel), a pluggable engine interface (abstraction with one implementation). Cost: about 1.2 MB gzip of WASM per host.

## SCXML and vertep YAML are both first-class

The designer opens and saves `*.scxml` and `*.vt.yaml` and keeps each file in its own format.

- motivated_by:: [[constraints#vertep semantics are the reference]] {note: "both surfaces lower onto one IR in vertep"}

Rejected: SCXML only (vertep's typed charts are mostly written in YAML); YAML only (YAML is a dialect with declared loss).

## The text file is the source of truth

The chart text is the only truth; the designer edits it through a format-preserving concrete syntax tree and minimal patches, and uses vertep only to validate and simulate the text.

- motivated_by:: [[decisions#SCXML and vertep YAML are both first-class]]
- motivated_by:: [[constraints#vertep's IR drops formatting]] {weight: primary}

Rejected: regenerating the file from vertep's IR on save (reformats the file and drops comments); a designer-only model exported to text (two sources of truth).

## Layout lives in vertep's reserved layout namespace

Layout is inline in the chart file, in a layout namespace vertep reserves as formatting (SCXML `vl:` attributes, YAML top-level `layout`), so layout never reaches the IR or the content hash.

- motivated_by:: [[constraints#Chart version is the hash of the IR]] {weight: primary}
- motivated_by:: [[constraints#vertep's readers keep or reject unknown markup]]
- motivated_by:: [[decisions#The text file is the source of truth]]

Rejected: a sidecar `*.layout.json` (two files to keep in sync, renames break the pair); an arbitrary foreign namespace (every drag would mint a new chart version and could trigger actor migrations). Needs an upstream change in vertep, see [[roadmap#M0 Upstream prerequisites]].

## SolidJS and SVG render the canvas

The canvas is SolidJS components rendering SVG, with elkjs automatic layout in a Web Worker and viewport culling.

- motivated_by:: [[constraints#Hosts render in web views]] {weight: primary}

Fine-grained signals update one attribute per highlight change without a virtual-DOM diff; SVG gives text, hit-testing, CSS-variable theming and accessibility. Rejected: React with React Flow (per-node re-renders, larger bundle), Canvas2D or WebGL with Pixi (manual text, hit-testing and a11y; only pays off past about 10k nodes), Svelte (comparable, coarser updates).

## Structure on the canvas, content in the inspector

States and transitions are edited on the canvas; transition details, the datamodel and executable content are edited as structured forms in an inspector; unmodeled content is shown read-only and preserved.

- motivated_by:: [[decisions#The text file is the source of truth]]

Rejected: structure only (charts could not be completed without text); block editors for everything (largest scope for v1).

## Simulation v1 with time travel

The first simulation shows the active configuration, enabled events, payload sends, context and an event log, with time travel over vertep's journal; a virtual clock, live context edits and recorded scenarios come later.

- motivated_by:: [[constraints#vertep WASM API surface]] {note: "asOf and the journal exist; a clock and context setter do not"}

## Hosts are thin adapters over one core

One designer core mounts in every host through a host bridge; VS Code, Obsidian, Electron and the web shell only adapt buffer, theme, files and diagnostics.

- motivated_by:: [[constraints#Hosts render in web views]]
- motivated_by:: [[decisions#The text file is the source of truth]] {note: "the host owns the buffer"}

## Custom editors for scxml and vt.yaml files

VS Code uses a CustomTextEditor and Obsidian a file view for `*.scxml` and `*.vt.yaml`; Obsidian also renders `scxml` and `vertep` code blocks. The `.vt.yaml` suffix exists because editors cannot bind a custom editor by file content.

- motivated_by:: [[constraints#VS Code binds custom editors by file pattern]] {weight: primary}

Rejected: sniffing any `.yaml` for `vertep: 1` (only a command could open it); side panels only (less integrated).

## Hosts ship web shell, VS Code, Obsidian, Electron

Hosts are delivered in this order: a web dev shell for iteration and tests, VS Code for developers, Obsidian with code blocks, Electron last as the web shell plus native files.

- motivated_by:: [[decisions#Hosts are thin adapters over one core]]

## Depend on published vertep packages

vertepnyk depends on `@vertep/web` and `@vertep/dm-ecma` from npm; publishing them is an upstream prerequisite, not a local link.

- motivated_by:: [[constraints#vertep WASM API surface]]

Rejected: a `link:` to the sibling checkout (CI must build vertep), vendored WASM (goes stale). A documented local override is allowed for working on both repos at once.

## Name, repository and license

The project is named vertepnyk (вертепник, the puppeteer who builds the vertep box and runs the show), lives at github.com/Volland/vertepnyk and is public under MIT OR Apache-2.0, like vertep.

Rejected names: rizba (carving), shopka (the vertep box), lialkar (the puppet maker).

## Obsidian assets are compiled into main.js

The Obsidian build gzips vertep's worker and WebAssembly builds and the layout worker into `main.js` (about 11 MB), so the plugin installs from the community directory as `main.js`, `manifest.json` and `styles.css` alone.

- motivated_by:: [[constraints#Obsidian installs only three files]] {weight: primary, since: "2026-11-13"}
- motivated_by:: [[decisions#vertep WASM is the only interpreter]] {weight: secondary, note: "the engine must ship with the plugin, offline"}

`EmbeddedAssetAdapter` serves `assets/<rel>` from the table and falls back to the plugin folder. Rejected: downloading the assets on first run (network access and a second trust path), and a manual zip only (not installable from the directory). The repository root carries `manifest.json` and `versions.json`, which the build copies from `packages/obsidian/static/`.

