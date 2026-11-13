---
type: Constraint
source: "vertep (sibling repository) and the host platforms; each section names its origin"
---
# Constraints

Rules vertepnyk did not choose: what vertep's semantics, IR and API impose, and what the host platforms allow.

## vertep semantics are the reference

Charts run in production on vertep, which implements the W3C SCXML interpretation algorithm; a simulation that differs from vertep would mislead its user.

- constrains:: [[decisions#vertep WASM is the only interpreter]] {strength: must, source: "vertep decisions: SCXML semantics are normative"}

## vertep WASM API surface

`@vertep/web` offers register (with violations), send, getSnapshot, can, journal, asOf, onTransition and memory storage; it has no controllable clock and no context setter, and is not yet on npm.

- constrains:: [[decisions#Simulation v1 with time travel]] {strength: must, source: "vertep bindings/js/packages/web/src/client.ts"}
- constrains:: [[decisions#Depend on published vertep packages]] {strength: must, source: "vertep components: vertep-wasm, open: publishing"}

## vertep's IR drops formatting

vertep's readers lower SCXML and YAML to an IR whose writers emit canonical text, losing comments, attribute order and indentation.

- constrains:: [[decisions#The text file is the source of truth]] {strength: must, source: "vertep-scxml writer.rs, vertep-yaml lib.rs write"}

## Chart version is the hash of the IR

vertep names a chart version by the hash of its canonical IR, and foreign-namespace markup is kept in the IR as extension nodes, so anything that reaches the IR changes the version.

- constrains:: [[decisions#Layout lives in vertep's reserved layout namespace]] {strength: must, source: "vertep-scxml loss.rs ForeignExtension; vertep chart-versioning"}

## vertep's readers keep or reject unknown markup

vertep's YAML reader rejects unknown keys, and its SCXML reader keeps foreign attributes as content, so layout needs a namespace vertep itself treats as formatting.

- constrains:: [[decisions#Layout lives in vertep's reserved layout namespace]] {strength: must, source: "vertep-yaml read.rs unknown key"}

## Hosts render in web views

VS Code webviews, Obsidian (Electron renderer) and Electron all render HTML in Chromium, under each host's content security policy, so one web UI serves all three.

- constrains:: [[decisions#SolidJS and SVG render the canvas]] {strength: should, source: "VS Code Webview API, Obsidian plugin API, Electron"}
- constrains:: [[decisions#Hosts are thin adapters over one core]] {strength: should, source: "VS Code Webview API, Obsidian plugin API, Electron"}

## VS Code binds custom editors by file pattern

VS Code selects a custom editor by filename pattern, never by file content, and Obsidian registers views by extension.

- constrains:: [[decisions#Custom editors for scxml and vt.yaml files]] {strength: must, source: "VS Code contributes.customEditors selector; Obsidian registerExtensions"}

## vertep WASM gaps worked around in sim

`@vertep/web` lacks a fork call, answers `can` only after the first journal entry, hides raised events and done data, and accepts ill-typed payloads at `send`.

`onTransition` also skips steps that took no transition.

- constrains:: [[decisions#Simulation v1 with time travel]] {strength: must, source: "vertep bindings/js/packages/web, found 2026-11-13"}

Sim emulates them: a fork replays the run's events into a fresh actor, `can` at the initial configuration uses a probe actor, internal events are inferred from the transitions taken, and typed payloads are checked first against a probe chart. Each emulation can be removed when vertep exposes the feature.

## Obsidian installs only three files

The Obsidian community installer downloads `main.js`, `manifest.json` and `styles.css` from a release, but the plugin needs about 20 MB of WebAssembly and worker files beside them.

- constrains:: [[decisions#Hosts ship web shell, VS Code, Obsidian, Electron]] {strength: must, source: "Obsidian plugin guidelines and community installer"}

Resolved by [[decisions#Obsidian assets are compiled into main.js]].

## Obsidian's Web Workers have Node integration

Obsidian starts Web Workers with Node integration, so inside a worker `process.versions.node` is set and there is no `window`; code that sniffs for Node takes its Node branch there.

- constrains:: [[decisions#Obsidian assets are compiled into main.js]] {strength: must, source: "Obsidian 1.14 desktop, observed 2026-11-13"}

`@vertep/web`'s worker does exactly that and imports `node:worker_threads`, which fails in a Blob worker, so the engine never started and validation stayed at "checking". The plugin build replaces that check in the bundled worker.

