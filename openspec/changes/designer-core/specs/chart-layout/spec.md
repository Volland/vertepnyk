## Purpose

Where a chart's visual layout lives and how it is produced: inline in the chart file, outside the chart's meaning, automatically laid out when missing and adjustable by hand.

## ADDED Requirements

### Requirement: Layout is stored inline
Layout (state position and size, transition route and label position, collapsed flag) SHALL be stored in the chart file itself, in vertep's reserved layout namespace: `vl:` attributes in SCXML and a top-level `layout` block keyed by state id in vertep YAML.

#### Scenario: Positions persist across reopen
- **WHEN** a user moves state `review` and saves, closes and reopens the chart
- **THEN** `review` is drawn at the moved position

### Requirement: Layout never changes the chart hash
Changing only layout SHALL NOT change the chart's content hash as computed by vertep (`vt hash`).

#### Scenario: Moving a box keeps the version
- **WHEN** a user moves three states and saves
- **THEN** vertep reports the same chart version IRI as before the move

### Requirement: Automatic layout
A chart with no layout, or states without layout entries, SHALL be laid out automatically, respecting nesting: children inside their compound parent, parallel regions side by side.

#### Scenario: Open a hand-written chart
- **WHEN** a user opens an SCXML chart that has no `vl:` attributes
- **THEN** every state is placed with no overlaps between siblings and every child inside its parent

#### Scenario: New state placed without moving others
- **WHEN** a user adds a state to a laid-out chart
- **THEN** existing states with layout entries keep their positions

### Requirement: Explicit re-layout
The user SHALL be able to re-run automatic layout on the whole chart or on one compound state, as one undoable edit.

#### Scenario: Re-layout one compound state
- **WHEN** a user re-lays out compound state `checkout`
- **THEN** only `checkout`'s descendants move

### Requirement: Layout does not block editing
Automatic layout SHALL run off the UI thread, and the canvas SHALL stay interactive while it runs.

#### Scenario: Large chart layout
- **WHEN** automatic layout runs on a chart with 500 states
- **THEN** the canvas keeps responding to pan and zoom during layout

### Requirement: Stale layout is tolerated
Layout entries for ids that no longer exist SHALL be ignored when drawing and removed on the next save; a missing or malformed entry SHALL fall back to automatic layout for that state.

#### Scenario: Orphan layout entry
- **WHEN** a chart's YAML `layout` block names state `old` that the chart no longer has
- **THEN** the chart draws without error and the saved file has no entry for `old`
