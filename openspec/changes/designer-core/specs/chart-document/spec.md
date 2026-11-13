## Purpose

How the designer reads and writes chart files: SCXML and vertep YAML, kept as text that the designer patches minimally, so people and git see exactly what changed.

## ADDED Requirements

### Requirement: Supported chart formats
The designer SHALL open and save charts in SCXML (`*.scxml`) and in vertep's YAML dialect (`*.vt.yaml`), and SHALL save a chart in the same format it was opened in.

#### Scenario: Open an SCXML chart
- **WHEN** a user opens a well-formed `order.scxml`
- **THEN** the designer shows every state and transition of the chart on the canvas

#### Scenario: Open a YAML chart
- **WHEN** a user opens a well-formed `order.vt.yaml` with a `vertep: 1` header
- **THEN** the designer shows every state and transition of the chart on the canvas

#### Scenario: Format is kept on save
- **WHEN** a user edits a chart opened from `order.vt.yaml` and saves it
- **THEN** the saved file is vertep YAML, not SCXML

### Requirement: Text is the source of truth
The chart file's text SHALL be the only source of truth. Every visual edit SHALL be applied to the text, and every external change to the text (another editor, git checkout) SHALL be reflected on the canvas without reopening.

#### Scenario: External text change appears on the canvas
- **WHEN** the text of an open chart changes outside the visual view, adding a state `refunded`
- **THEN** the canvas shows `refunded` without the user reopening the file

#### Scenario: Visual edit changes the text
- **WHEN** a user adds a transition `retry` from `failed` to `payment` on the canvas
- **THEN** the chart text contains that transition

### Requirement: Format-preserving edits
A visual edit SHALL change only the text spans that the edit concerns. Comments, attribute order, quoting, indentation and blank lines outside those spans SHALL be preserved byte for byte.

#### Scenario: Comments survive an edit
- **WHEN** a user renames state `cart` to `basket` in a YAML chart whose header has ten comment lines
- **THEN** all ten comment lines are unchanged in the saved file

#### Scenario: Untouched regions are byte-identical
- **WHEN** a user moves one transition's target in an SCXML chart
- **THEN** a text diff of the file before and after touches only the lines of that transition

### Requirement: Unmodeled content is preserved
Elements, attributes and keys the designer does not model (foreign namespaces, `vt:` extensions, `invoke` content, scripts) SHALL survive any sequence of visual edits unchanged.

#### Scenario: Extension survives
- **WHEN** a chart contains a `vt:decide` state and a user moves a sibling state
- **THEN** the `vt:decide` markup is byte-identical after save

### Requirement: Rename updates references
Renaming a state SHALL update every reference to its id in the same chart: transition targets, `initial` attributes and keys, history defaults and layout entries.

#### Scenario: Rename a transition target
- **WHEN** a user renames `payment` to `paying` and two transitions target `payment`
- **THEN** both transitions target `paying` and no reference to `payment` remains

### Requirement: Undo and redo
Every visual edit SHALL be one undoable step, and undo SHALL restore the exact previous text. A drag or a typed inspector value SHALL merge into one step.

#### Scenario: Undo a drag
- **WHEN** a user drags a state across the canvas and then undoes once
- **THEN** the text is byte-identical to before the drag

### Requirement: Unparseable text is not overwritten
When the text cannot be parsed, the designer SHALL show the parse error with its line and column, keep the last good canvas read-only, and SHALL NOT write to the file until the text parses again.

#### Scenario: Broken XML
- **WHEN** the text of an open SCXML chart loses a closing tag
- **THEN** the designer reports the error with line and column and visual editing is disabled until it is fixed

### Requirement: New chart
The designer SHALL create a new chart in either format with one initial atomic state, and the result SHALL be accepted by vertep without violations.

#### Scenario: New SCXML chart validates
- **WHEN** a user creates a new SCXML chart
- **THEN** vertep validation of the new chart reports no violations
