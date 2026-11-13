## Purpose

A standalone desktop designer for people who use neither VS Code nor Obsidian, with native file handling and the same designer core.

## ADDED Requirements

### Requirement: Native file handling
The app SHALL open and save `*.scxml` and `*.vt.yaml` files through native dialogs, keep a recent-files list, and register itself as an opener for both extensions.

#### Scenario: Open from the OS
- **WHEN** a user double-clicks `order.vt.yaml` with the app installed
- **THEN** the app opens the chart

### Requirement: External changes are picked up
The app SHALL watch open files and reload them when changed on disk; if the document has unsaved edits it SHALL ask before reloading.

#### Scenario: Git checkout while open
- **WHEN** an open, unmodified chart changes on disk
- **THEN** the app shows the new content

### Requirement: Multiple documents
The app SHALL open several charts at once in tabs or windows, each with its own simulation.

#### Scenario: Two simulations
- **WHEN** two charts are open and simulating
- **THEN** sending an event in one does not affect the other

### Requirement: Secure renderer
The renderer SHALL run with context isolation and without Node.js integration; file access SHALL go only through a narrow preload API.

#### Scenario: No Node in the renderer
- **WHEN** the renderer evaluates `typeof require`
- **THEN** it is `undefined`

### Requirement: Desktop distribution
The app SHALL be built for macOS (universal), Windows and Linux and published on GitHub Releases.

#### Scenario: Release artifacts
- **WHEN** a version tag is pushed
- **THEN** CI attaches macOS, Windows and Linux builds to the GitHub release
