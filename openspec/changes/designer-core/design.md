## Context

See proposal.md for motivation. vertep (sibling repo) provides the semantics: `@vertep/web` exposes `ActorSystem.register` (SCXML, YAML; returns violations on `ChartInvalid`), `ActorRef.send`, `getSnapshot`, `can(event)`, `journal`, `asOf({position})` and `onTransition`, running the interpreter, the shell and a tiramemsu journal in one worker (`storage: "memory"` for volatile runs). vertep's Rust crates also have IR→SCXML and IR→YAML writers, but the IR drops comments and formatting.

Three facts found in vertep's code shape this design:

- vertep's SCXML reader keeps foreign-namespace attributes as opaque extension nodes in the IR (`LossKind::ForeignExtension`), and the chart version is the hash of the canonical IR. Inline layout in an arbitrary namespace would therefore change the chart's version on every drag.
- vertep's YAML reader rejects unknown keys (`unknown key ... in ...`), so a `layout` block is refused today.
- `@vertep/web` has no controllable clock; delayed `<send>` runs on wall-clock time.

## Goals / Non-Goals

**Goals:**
- One host-independent core that VS Code, Obsidian, Electron and the web shell embed unchanged.
- Visual edits that are minimal text patches, safe on hand-written files.
- Simulation identical to vertep's runtime behaviour.
- Smooth rendering of charts up to 1,000 states.

**Non-Goals:**
- A second interpreter, or any transition logic in TypeScript.
- Charts spread across several files (`src=` includes), RDF as an editable surface.
- A virtual clock, live context edits, recorded scenarios (later milestones).
- Collaborative real-time editing.

## Decisions

### D1. vertep WASM is the only interpreter
Simulation and validation call `@vertep/web`; the designer only renders what vertep reports (configuration, enabled events via `can`, transitions via `onTransition`, context via snapshots).
- Rejected: a TypeScript SCXML interpreter (semantic drift, duplicate conformance work); XState runtime (different semantics, no full datamodel); a pluggable engine interface (abstraction with one implementation).
- motivated_by: the vertep semantics constraint. Consequence: about 1.2 MB gzip of WASM in every host, acceptable for editor and desktop hosts.

### D2. The text file is the source of truth, edited through a concrete syntax tree
`core` parses SCXML into a lossless XML CST (positions of every token, comments, whitespace) and YAML with the `yaml` package's `Document` API (keeps comments and styles). A thin semantic view (states, transitions, data, content) is derived from the CST with back-pointers to spans. Edits are commands that produce minimal text patches; the patched text is re-parsed incrementally. The host owns the buffer (VS Code `TextDocument`, Obsidian `TFile`), so undo, dirty state and git work natively.
- Rejected: regenerate from vertep's IR (reformats files, drops comments); a designer-only JSON model with export (two sources of truth).

### D3. Layout lives in vertep's reserved layout namespace
vertep reserves `https://w3id.org/vertep/layout#` (prefix `vl:`): SCXML attributes `vl:x`, `vl:y`, `vl:w`, `vl:h`, `vl:collapsed` on states and `vl:route`, `vl:label` on transitions, and in YAML a top-level `layout:` mapping keyed by state id (transitions keyed `source#index`). Both readers classify them as formatting: not in the IR, not in the hash, never a strict-mode failure. This is an upstream change in vertep shipped in milestone M0.
- Rejected: sidecar `chart.layout.json` (two files to keep in sync, renames break the pair); arbitrary foreign namespace (layout changes the chart version).

### D4. SolidJS + SVG render the canvas; elkjs lays it out in a worker
Solid's fine-grained signals update one SVG attribute when one state's highlight changes, with no virtual-DOM diff; SVG gives crisp text, native hit-testing, CSS-variable theming (VS Code and Obsidian tokens) and accessibility. Viewport culling skips off-screen subtrees; edges are drawn as single paths. elkjs (`layered`, hierarchical ports) runs in a Web Worker and lays out only states without layout entries unless asked.
- Rejected: React + React Flow (per-node component re-renders, larger bundle, weak deep nesting); Canvas2D/WebGL with Pixi (manual text, hit-testing, a11y, theming; only pays off past ~10k nodes); Svelte (comparable, slightly coarser updates).

### D5. Packages
`core` (CST, semantic view, commands, undo, no DOM), `layout` (elk worker), `sim` (adapter over `@vertep/web`: one `ActorSystem` per document, memory storage, journal and `asOf` for time travel), `canvas` (Solid/SVG), `inspector` (Solid forms), `designer` (composes them behind a host interface), `web-shell`. Hosts live in change `editor-hosts`.

### D6. Time travel uses vertep's journal
Each run is one actor in a memory `ActorSystem` with `journal: true`. Stepping back reads `asOf({position})`; forking starts a new actor from the journal prefix (vertep's `fork` journal entries) and keeps the original run selectable. Replay after an edit re-sends the run's external events, read from `journal()`, to a fresh actor of the edited chart.

### D7. Validation is register-in-a-scratch-system
Validation registers the current text in a scratch `ActorSystem` and maps `ChartInvalid` violations to CST spans by their document path and line/column. A monotonic edit counter discards stale results. The version IRI comes from the successful registration.

## Risks / Trade-offs

- [`@vertep/web` unpublished; layout namespace not yet in vertep] → milestone M0 does both upstream before core work depends on them; until then development links the sibling checkout.
- [Violation locations may not carry enough position data for every rule] → map by state id when no span is given; file an upstream issue for missing spans.
- [No public "set context" or virtual clock in vertep] → out of scope for v1; both are recorded as later milestones with upstream dependencies.
- [WASM worker start-up cost per validation] → keep one long-lived scratch system per document and re-register; measure in the web shell.
- [YAML CST edits on flow-style mappings may reformat a line] → keep flow style on the edited node; property tests compare untouched spans.
- [elkjs layout of deeply nested parallel states can be slow] → worker, cancellation, and layout only of the affected compound state.

## Migration Plan

New project; no migration. Version 0.x until all four hosts ship.

## Open Questions

None open. Settled during implementation: a transition's `vl:route` / YAML `route` is the full absolute polyline (start, bends, end) and `label` is the absolute centre of the label box; state coordinates are relative to the parent.
