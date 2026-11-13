## Purpose

The inspector panel: structured forms for what the canvas does not show directly, namely transition details, the datamodel and executable content, so charts can be completed without editing text.

## ADDED Requirements

### Requirement: Inspect the selection
The inspector SHALL show and edit the properties of the selected element: a state's id, kind, initial child and history type; a transition's event descriptor, guard, targets and type (internal or external).

#### Scenario: Change transition type
- **WHEN** a user sets a selected transition's type to internal
- **THEN** the transition's text has `type="internal"` (SCXML) or `type: internal` (YAML)

### Requirement: Edit the datamodel
The inspector SHALL show the chart's datamodel kind and its data items, and SHALL let the user add, remove and edit data items (id, initial expression, and type for typed CEL charts).

#### Scenario: Add a data item
- **WHEN** a user adds data item `attempts` with initial expression `0`
- **THEN** the chart declares `attempts` with initial value `0`

### Requirement: Edit executable content
The inspector SHALL list and edit the executable content of `onentry`, `onexit` and transitions, as structured forms for `assign`, `raise`, `send`, `log`, `cancel`, `if`/`elseif`/`else` and `foreach`, with add, remove and reorder.

#### Scenario: Add an assign on entry
- **WHEN** a user adds an `assign` of `attempts + 1` to `attempts` on entry of `payment`
- **THEN** `payment`'s entry content contains that assignment

### Requirement: Expression fields are checked
Guard and expression fields SHALL be checked against the chart's datamodel as the user types, with errors shown at the field.

#### Scenario: CEL type error at the field
- **WHEN** a user types the guard `total > "100"` in a typed CEL chart where `total` is a decimal
- **THEN** the guard field shows a type error

### Requirement: Unmodeled content is shown read-only
Executable content and children the inspector does not model (`script`, `invoke` bodies, extension elements) SHALL be shown as read-only items with an action that reveals them in the text view, and SHALL be kept intact when surrounding items are edited.

#### Scenario: Script block stays intact
- **WHEN** a state's entry has a `script` and a user adds a `log` after it
- **THEN** the `script` text is byte-identical after save

### Requirement: Event catalogue
The inspector SHALL offer the chart's known event names (declared `events` in YAML and every event descriptor used by transitions) when entering an event, and SHALL accept new names.

#### Scenario: Suggest a known event
- **WHEN** a user starts typing `pa` in a transition's event field and the chart uses `pay`
- **THEN** `pay` is offered
