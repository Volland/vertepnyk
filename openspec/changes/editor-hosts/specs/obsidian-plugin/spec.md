## Purpose

The designer inside Obsidian, so charts live in a vault next to the notes that explain them, and notes can embed charts you can simulate.

## ADDED Requirements

### Requirement: Chart file view
The plugin SHALL register a view for `*.scxml` and `*.vt.yaml` files in the vault, giving them the full designer and saving through the vault.

#### Scenario: Open from the file explorer
- **WHEN** a user opens `order.scxml` from Obsidian's file explorer
- **THEN** it opens in the designer and edits are saved to the vault file

### Requirement: Chart code blocks
The plugin SHALL render fenced code blocks with language `scxml` or `vertep` in reading and live-preview modes as a chart canvas, with a simulation panel that can be opened in place.

#### Scenario: Simulate a chart in a note
- **WHEN** a note contains a `vertep` code block with the traffic-light chart and the user opens its simulation panel
- **THEN** they can send events and watch the configuration change in the note

### Requirement: Code-block editing writes back
Editing a chart from a code block's designer SHALL write the changed text back into that code block in the note, preserving the rest of the note.

#### Scenario: Layout change in a note
- **WHEN** a user moves a state in a code-block chart
- **THEN** only that code block's text changes in the note

### Requirement: Embeds and links
A link or embed (`![[order.scxml]]`) to a chart file SHALL render the chart in the note.

#### Scenario: Embed a chart file
- **WHEN** a note contains `![[order.scxml]]`
- **THEN** the note shows the chart

### Requirement: Obsidian distribution
The plugin SHALL meet Obsidian community plugin requirements (manifest, versions file, no remote code) and SHALL work on Obsidian desktop; mobile support SHALL be declared only once tested.

#### Scenario: Desktop only declared
- **WHEN** the plugin is released before mobile testing
- **THEN** its manifest declares it desktop-only
