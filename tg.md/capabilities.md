---
type: Capability
status: draft
openspec: [chart-document, chart-layout, canvas-editing, chart-inspector, chart-validation, chart-simulation, web-shell, host-bridge, vscode-extension, obsidian-plugin, electron-app]
---
# Capabilities

Every vertepnyk capability, the milestone that delivers it, and the OpenSpec capability that specifies it (in changes `designer-core` and `editor-hosts` until archived).

## Chart document

Open, parse, patch and save SCXML and vertep YAML through a format-preserving syntax tree, with undo. OpenSpec: `chart-document`.

- scheduled_in:: [[roadmap#M1 Designer core]]

## Chart layout

Inline layout in vertep's reserved namespace, automatic layout of nested charts, re-layout, tolerance of stale entries. OpenSpec: `chart-layout`.

- scheduled_in:: [[roadmap#M1 Designer core]]

## Canvas editing

Drawing and structurally editing every SCXML state kind and transition, navigation, theming, accessibility and performance. OpenSpec: `canvas-editing`.

- scheduled_in:: [[roadmap#M1 Designer core]]

## Chart inspector

Structured forms for transitions, the datamodel and executable content; unmodeled content shown read-only. OpenSpec: `chart-inspector`.

- scheduled_in:: [[roadmap#M1 Designer core]]

## Chart validation

Continuous validation by vertep with located diagnostics and the chart's version IRI. OpenSpec: `chart-validation`.

- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## Chart simulation

Running the chart on vertep's interpreter: events with payloads, configuration, context, event log and time travel. OpenSpec: `chart-simulation`.

- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## Web shell

The browser page that hosts the designer for development, demos and end-to-end tests. OpenSpec: `web-shell`.

- scheduled_in:: [[roadmap#M2 Simulation and web shell]]

## Host bridge

The contract between the designer core and every host: buffer, theme, view state, diagnostics, assets. OpenSpec: `host-bridge`.

- scheduled_in:: [[roadmap#M3 VS Code extension]]

## VS Code extension

The custom text editor, commands and Problems integration in VS Code. OpenSpec: `vscode-extension`.

- scheduled_in:: [[roadmap#M3 VS Code extension]]

## Obsidian plugin

The chart file view, code-block charts and embeds in Obsidian. OpenSpec: `obsidian-plugin`.

- scheduled_in:: [[roadmap#M4 Obsidian plugin]]

## Electron app

The standalone desktop designer with native files and per-document simulations. OpenSpec: `electron-app`.

- scheduled_in:: [[roadmap#M5 Electron app]]
