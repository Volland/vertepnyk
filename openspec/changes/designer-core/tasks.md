## 0. Upstream prerequisites in vertep (milestone M0)

- [x] 0.1 (branch `layout-namespace`, not merged) In vertep: reserve the layout namespace `https://w3id.org/vertep/layout#` (`vl:`) in vertep-scxml as a formatting loss kind (not in the IR, not in the hash, never a strict failure), with tests
- [x] 0.2 (branch `layout-namespace`, not merged) In vertep: accept a top-level `layout` key in vertep-yaml, ignored by the reader and kept out of the IR and hash, with tests
- [ ] 0.3 In vertep: publish `@vertep/web` and `@vertep/dm-ecma` to npm (release decision and credentials belong to the maintainer)
- [x] 0.4 Confirm `ChartInvalid` violations carry line/column or document path; file an upstream issue for any rule that does not

## 1. Workspace setup

- [x] 1.1 pnpm workspace with packages `core`, `layout`, `sim`, `canvas`, `inspector`, `designer`, `web-shell`; TypeScript strict, Vite, Vitest, Playwright, ESLint, Prettier
- [x] 1.2 Depend on the published `@vertep/web`/`@vertep/dm-ecma`; a documented `link:` override for working against a local vertep checkout
- [x] 1.3 CI on GitHub Actions: typecheck, unit, Playwright (Chromium headless), `tg check`, `tg ontology check`, `openspec validate --all --strict`
- [x] 1.4 Fixtures: copy vertep's example charts (order, traffic light, typed order, decider) into `fixtures/`

## 2. Chart document (`core`)

- [x] 2.1 Lossless XML CST for SCXML (tokens, comments, whitespace, namespaces) with a round-trip property test: parse→print is byte-identical on all fixtures and the W3C suite documents
- [x] 2.2 YAML document layer over the `yaml` package's `Document` API with the same round-trip test
- [x] 2.3 Semantic view (states, transitions, data, executable content) derived from either CST with span back-pointers
- [x] 2.4 Edit commands producing minimal text patches: add/remove/rename/reparent state, add/remove/retarget transition, set initial, set properties
- [x] 2.5 Rename updates every reference (targets, `initial`, history defaults, layout entries)
- [x] 2.6 Undo/redo stack with merge of continuous edits; host-owned buffer adapter interface
- [x] 2.7 Parse-error mode: last good view read-only, no writes until the text parses
- [x] 2.8 New-chart templates for SCXML and YAML
- [x] 2.9 Annotate implementations with `@tg: implements::` for `chart-document`: Supported chart formats, Text is the source of truth, Format-preserving edits, Unmodeled content is preserved, Rename updates references, Undo and redo, Unparseable text is not overwritten, New chart
- [x] 2.10 Annotate a test per `chart-document` scenario with `@tg: verifies::` directly above it

## 3. Layout (`core`, `layout`)

- [x] 3.1 Read and write `vl:` attributes and the YAML `layout` block through the CST; drop orphan entries on save
- [x] 3.2 elkjs worker: hierarchical layered layout of nested and parallel states, incremental (only unplaced states), cancellable
- [x] 3.3 Re-layout of the whole chart or one compound state as one undoable edit
- [x] 3.4 Test that moving states keeps vertep's version IRI unchanged (needs 0.1/0.2)
- [x] 3.5 Annotate `chart-layout` implementations (Layout is stored inline, Layout never changes the chart hash, Automatic layout, Explicit re-layout, Layout does not block editing, Stale layout is tolerated) and a test per scenario

## 4. Canvas (`canvas`)

- [x] 4.1 Solid + SVG scene: state kinds, parallel regions, history markers, initial arrows, transition paths and labels, targetless handlers
- [x] 4.2 Viewport: pan, zoom, fit, zoom-to-selection, culling of off-screen subtrees
- [x] 4.3 Interactions: create states, draw and retarget transitions, reparent with validity check, delete with impact prompt, multi-select, clipboard with unique ids, collapse/expand
- [x] 4.4 Theme tokens as CSS variables with light, dark and high-contrast defaults
- [x] 4.5 Keyboard navigation and ARIA roles/labels for states and transitions
- [x] 4.6 Performance benchmark: generated 1,000-state/2,000-transition chart, Playwright frame-time measurement in CI (median ≤ 16.7 ms)
- [x] 4.7 Annotate `canvas-editing` implementations (Every SCXML state kind is drawn, Transitions are drawn with their labels, Create states, Create and retarget transitions, Reparent states, Delete elements, Selection and clipboard, Navigation, Rendering performance, Host theming, Accessible canvas) and a test per scenario

## 5. Inspector (`inspector`)

- [x] 5.1 Selection forms for states and transitions
- [x] 5.2 Datamodel editor (items, initial expressions, CEL types)
- [x] 5.3 Executable content editor: assign, raise, send, log, cancel, if/elseif/else, foreach; add, remove, reorder
- [x] 5.4 Expression checking at the field through the validation service
- [x] 5.5 Read-only items for script, invoke and extensions with reveal-in-text
- [x] 5.6 Event catalogue suggestions
- [x] 5.7 Annotate `chart-inspector` implementations (Inspect the selection, Edit the datamodel, Edit executable content, Expression fields are checked, Unmodeled content is shown read-only, Event catalogue) and a test per scenario

## 6. Validation (`sim`)

- [x] 6.1 Scratch `ActorSystem` per document; debounced re-registration with stale-result discard
- [x] 6.2 Map violations to CST spans (path, line/column, else state id)
- [x] 6.3 Datamodel build selection (CEL default, ECMAScript via `@vertep/dm-ecma`)
- [x] 6.4 Diagnostics list, canvas markers, reveal; version IRI display
- [x] 6.5 Annotate `chart-validation` implementations (Validation runs on vertep, Continuous validation, Diagnostics are located, Datamodel-aware checks, Content hash shown) and a test per scenario

## 7. Simulation (`sim`, `designer`)

- [x] 7.1 Run controller: memory `ActorSystem` with journal, start/reset, refuse invalid charts
- [x] 7.2 Configuration and taken-transition highlighting from snapshots and `onTransition`
- [x] 7.3 Enabled events via `can`, free event entry, JSON payload editor with typed-payload checking
- [x] 7.4 Context view with change marks; event log with internal events
- [x] 7.5 Time travel: step back/forward via `asOf`, fork runs, run picker
- [x] 7.6 Stale-run detection and replay of external events on the edited chart; done state handling
- [x] 7.7 Annotate `chart-simulation` implementations (Simulation runs on the vertep interpreter, Start and reset, Active configuration is highlighted, Enabled events are offered, Send events with payload, Context is shown, Event log, Time travel, Live edits during simulation, Final state ends the run) and a test per scenario

## 8. Web shell (`web-shell`)

- [x] 8.1 Vite app composing `designer` with a CodeMirror text pane in two-way sync
- [x] 8.2 File System Access with download fallback; example gallery
- [x] 8.3 Playwright end-to-end suite over the gallery examples
- [x] 8.4 Annotate `web-shell` implementations (Browser host, Local file access, Side-by-side text, Example gallery) and a test per scenario

## 9. Graph and docs

- [x] 9.1 Record design decisions D1–D7 and constraints in `tg.md/decisions.md` and `tg.md/constraints.md` with typed edges (done for D1–D4 at planning; update with implementation notes)
- [x] 9.2 Update the component sections in `tg.md/components.md` and `tg.md/views/architecture.md`; list capabilities in `openspec:` frontmatter
- [x] 9.3 Run `tg check`, `tg ontology check` and `tg trace <capability> --gaps` for every capability and close every gap
