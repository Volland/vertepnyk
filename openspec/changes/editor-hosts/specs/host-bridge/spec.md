## Purpose

The contract between the designer core and the program that hosts it, so that a chart behaves the same in every host and the core never depends on a host's API.

## ADDED Requirements

### Requirement: Hosts own the buffer
The host SHALL own the chart text buffer and its save, dirty state and undo integration; the designer SHALL read the text from the host and send edits to the host as text patches.

#### Scenario: Dirty state after a visual edit
- **WHEN** a user moves a state in any host
- **THEN** the host marks the document as modified

### Requirement: Same behaviour in every host
Given the same chart text, every host SHALL show the same canvas, the same diagnostics and the same simulation results.

#### Scenario: Cross-host simulation
- **WHEN** the order chart is simulated with the same three events in VS Code, Obsidian and Electron
- **THEN** all three end in the same configuration with the same context

### Requirement: Host theme is applied
Each host SHALL supply its current theme as tokens and SHALL notify the designer when the theme changes.

#### Scenario: VS Code theme change
- **WHEN** the user switches VS Code to a dark theme while a chart is open
- **THEN** the canvas follows without reopening

### Requirement: Host persists view state
Each host SHALL persist per-document view state (viewport, collapsed states outside the file, panel sizes) and restore it when the document is reopened.

#### Scenario: Viewport restored
- **WHEN** a user zooms into `checkout`, closes the chart and reopens it
- **THEN** the viewport shows `checkout` at the same zoom

### Requirement: WebAssembly loads in every host
Each host SHALL load vertep's WebAssembly worker from within the host's packaged assets, with no network access.

#### Scenario: Offline start
- **WHEN** a chart is opened in any host with the network disabled
- **THEN** validation and simulation work
