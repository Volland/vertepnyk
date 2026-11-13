## Purpose

The designer inside VS Code, on the editor's own text document, so charts in a repository are edited visually with native undo, save, diff and diagnostics.

## ADDED Requirements

### Requirement: Custom editor for chart files
The extension SHALL register a custom text editor for `*.scxml` and `*.vt.yaml` files backed by VS Code's text document, available as the default or an optional editor according to a setting.

#### Scenario: Open a chart visually
- **WHEN** a user opens `order.scxml` in VS Code with the extension installed
- **THEN** the chart opens in the visual designer

### Requirement: Text and visual toggle
The user SHALL be able to switch the same document between the visual designer and VS Code's text editor, and to open them side by side, with edits in either shown in the other.

#### Scenario: Side by side
- **WHEN** a user opens the text editor beside the designer and types a new state
- **THEN** the designer shows the new state

### Requirement: Native undo and save
Visual edits SHALL go through VS Code's text document so that VS Code's undo, redo, save, auto-save, hot exit and source-control diff apply to them.

#### Scenario: Undo through VS Code
- **WHEN** a user adds a transition visually and presses the undo shortcut
- **THEN** the transition is removed

### Requirement: Problems panel
Validation diagnostics SHALL appear in VS Code's Problems panel with file locations, and selecting one SHALL reveal the element in the designer.

#### Scenario: Violation in Problems
- **WHEN** a chart has an unknown transition target
- **THEN** the Problems panel lists the violation for that file

### Requirement: Commands
The extension SHALL provide commands to create a new chart (SCXML or YAML), open the designer for the active file, re-layout, start, reset and step the simulation, and export the canvas as SVG.

#### Scenario: New chart command
- **WHEN** a user runs the new YAML chart command
- **THEN** a new untitled `*.vt.yaml` chart opens in the designer

### Requirement: VS Code distribution
The extension SHALL be published to the VS Code Marketplace and Open VSX, SHALL work in VS Code desktop, and SHALL declare a webview content security policy that allows only its own scripts and WebAssembly.

#### Scenario: Content security policy
- **WHEN** the webview loads
- **THEN** no script from outside the extension is allowed to run
