## Purpose

Continuous validation of the chart being edited by vertep itself, so the designer reports the same violations that vertep would raise at registration.

## ADDED Requirements

### Requirement: Validation runs on vertep
Validation SHALL be performed by vertep's interpreter build (`@vertep/web` registration), and the designer SHALL report exactly the violations vertep reports, without adding or suppressing any.

#### Scenario: Unknown target
- **WHEN** a transition targets an id the chart does not define
- **THEN** the designer shows vertep's violation for that transition

### Requirement: Continuous validation
The chart SHALL be validated after every edit, debounced, without blocking the canvas; a newer edit SHALL cancel the validation of an older one.

#### Scenario: Results follow the latest text
- **WHEN** a user makes two edits within the debounce window
- **THEN** only the diagnostics of the text after the second edit are shown

### Requirement: Diagnostics are located
Each violation SHALL be shown on the canvas element it concerns and in a diagnostics list with message, severity and text location; selecting it SHALL select and reveal the element.

#### Scenario: Reveal from the list
- **WHEN** a user selects a violation about state `review` in the list
- **THEN** the canvas selects `review` and scrolls it into view

### Requirement: Datamodel-aware checks
Typed CEL charts SHALL be checked with their declared types, and the chart's `datamodel` attribute SHALL select which vertep datamodel build validates and runs it (CEL by default, ECMAScript through `@vertep/dm-ecma`).

#### Scenario: ECMAScript chart
- **WHEN** a chart declares `datamodel="ecmascript"`
- **THEN** it is validated and simulated with the ECMAScript datamodel build

### Requirement: Content hash shown
The designer SHALL show the chart's version IRI (content hash) as computed by vertep for the current text.

#### Scenario: Hash follows semantic edits only
- **WHEN** a user changes a guard
- **THEN** the shown version IRI changes, and moving a state afterwards does not change it again
