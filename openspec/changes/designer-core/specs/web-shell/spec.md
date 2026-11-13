## Purpose

A plain browser page that hosts the designer core, used for development, demos and end-to-end tests of the core without any editor host.

## ADDED Requirements

### Requirement: Browser host
The web shell SHALL host the full designer (canvas, inspector, validation, simulation) in a current Chromium, Firefox or Safari without installation.

#### Scenario: Load and simulate in the browser
- **WHEN** a user opens the web shell and loads the bundled order example
- **THEN** they can edit and simulate it

### Requirement: Local file access
The web shell SHALL open and save chart files through the browser's file access (File System Access API where available, upload and download otherwise).

#### Scenario: Save without file system access
- **WHEN** the browser lacks the File System Access API and the user saves
- **THEN** the chart is downloaded as a file with its original name

### Requirement: Side-by-side text
The web shell SHALL show the chart text next to the canvas and keep both in sync in both directions.

#### Scenario: Type in the text
- **WHEN** a user adds a state in the text pane
- **THEN** it appears on the canvas

### Requirement: Example gallery
The web shell SHALL include vertep's example charts (order, traffic light, typed order) for trying the designer.

#### Scenario: Open the traffic light
- **WHEN** a user picks the traffic-light example
- **THEN** it opens laid out and ready to simulate
