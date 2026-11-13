## Why

vertep runs full W3C SCXML statecharts as durable actors, but the only way to author or try a chart today is to write SCXML or YAML by hand and run it from code. People who design behaviour (product, QA, analysts, developers sketching) need to draw a chart, see it, and drive it with events to check that it does what they mean, without writing a line of code. vertep already ships its interpreter as WebAssembly (`@vertep/web`), so a designer can simulate on the exact semantics production runs, which no general-purpose diagram tool can.

## What Changes

- A shared, host-independent designer core in TypeScript: document model, canvas, inspector, validation and simulation.
- Open and save `*.scxml` and `*.vt.yaml` files; the text is the source of truth and edits are minimal text patches that keep comments and formatting.
- Visual layout (positions, sizes, edge routes) stored inline in vertep's reserved layout namespace, so moving a box never changes the chart's content hash.
- A canvas that draws atomic, compound, parallel, final, history and initial states and transitions, with automatic layout, manual adjustment, zoom/pan and viewport culling.
- An inspector that edits transitions (event, guard, target, type), the datamodel and executable content as structured forms; anything it does not model stays untouched in the file.
- Live validation through vertep: SHACL and datamodel (CEL type) violations shown on the canvas and as a list.
- Simulation on `@vertep/web`: active configuration highlighted, enabled events listed, events sent with a JSON payload, context shown, and time travel over the run's journal (step back, step forward, fork a new run from any point).
- A web dev shell (a plain browser page) that hosts the core for development and end-to-end tests.

Out of scope for this change (later milestones): a virtual clock for delayed events, live context editing, recorded scenarios, the editor hosts (change `editor-hosts`).

## Capabilities

### New Capabilities
- `chart-document`: open, parse, patch and serialize SCXML and vertep YAML charts through a format-preserving syntax tree, with undo/redo.
- `chart-layout`: the inline layout data, automatic layout of nested charts, and how layout survives edits and renames.
- `canvas-editing`: drawing and structurally editing states and transitions on the canvas, selection, zoom, pan and rendering performance.
- `chart-inspector`: structured editing of transition details, the datamodel and executable content, with preservation of anything unmodeled.
- `chart-validation`: continuous validation through vertep and presentation of diagnostics.
- `chart-simulation`: running the chart on vertep's interpreter, sending events, observing configuration and context, and time travel.
- `web-shell`: the browser page that hosts the core for development and tests.

### Modified Capabilities
<!-- none: new project -->

## Impact

- New repository `vertepnyk` (pnpm workspace): packages `core`, `canvas`, `inspector`, `sim`, `layout`, `web-shell`.
- Depends on vertep: `@vertep/web` and `@vertep/dm-ecma` published to npm, and the reserved layout namespace accepted by vertep's SCXML and YAML readers as formatting (both upstream prerequisites, milestone M0).
- lat.md sections: `tg.md/decisions.md` (every grilling decision), `tg.md/constraints.md` (vertep semantics, hash, host limits), `tg.md/components.md`, `tg.md/roadmap.md`, `tg.md/views/architecture.md`.
- Binding decisions: [[decisions#vertep WASM is the only interpreter]], [[decisions#The text file is the source of truth]], [[decisions#Layout lives in vertep's reserved layout namespace]], [[decisions#SolidJS and SVG render the canvas]].
- Requirements added: `[[openspec:chart-document#Format-preserving edits]]`, `[[openspec:chart-simulation#Simulation runs on the vertep interpreter]]` and the rest listed in each spec.
