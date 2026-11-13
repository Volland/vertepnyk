## Purpose

The canvas on which a chart is drawn and structurally edited: states, transitions, selection and navigation, fast enough for large charts and themed by its host.

## ADDED Requirements

### Requirement: Every SCXML state kind is drawn
The canvas SHALL draw atomic, compound, parallel, final and history (shallow and deep) states and the initial transition of each compound state, each with a distinct visual form; parallel regions SHALL be drawn as separated regions of their parent.

#### Scenario: Parallel state
- **WHEN** a chart has a parallel state with regions `payment` and `shipping`
- **THEN** both regions are drawn inside the parallel state, visually separated

#### Scenario: History state
- **WHEN** a compound state contains a deep history state
- **THEN** it is drawn with a deep-history marker distinct from a shallow one

### Requirement: Transitions are drawn with their labels
Each transition SHALL be drawn from its source to each target with a label showing its event descriptor and, when present, its guard; eventless and targetless (self-handling) transitions SHALL be visually distinguishable.

#### Scenario: Guarded transition label
- **WHEN** a transition has event `authorized` and condition `total > 100`
- **THEN** its label shows `authorized [total > 100]`

#### Scenario: Targetless transition
- **WHEN** a transition has an event but no target
- **THEN** it is drawn as an internal handler on its source, not as an edge to another state

### Requirement: Create states
The user SHALL be able to create an atomic, compound, parallel, final or history state at a chosen position, at the top level or inside a compound or parallel state, with a generated unique id.

#### Scenario: Create a nested state
- **WHEN** a user creates an atomic state inside compound state `checkout`
- **THEN** the new state is a child of `checkout` in the text with an id unique in the chart

### Requirement: Create and retarget transitions
The user SHALL be able to draw a transition from a source state to one or more targets, change its source or targets by dragging its ends, and set or change the initial child of a compound state.

#### Scenario: Draw a transition
- **WHEN** a user drags from `cart` to `payment` and enters event `pay`
- **THEN** the chart has a transition on `cart` with event `pay` targeting `payment`

### Requirement: Reparent states
The user SHALL be able to move a state into or out of a compound or parallel state; the move SHALL be rejected if it would make the chart invalid (for example, moving a state into its own descendant).

#### Scenario: Move into own descendant is refused
- **WHEN** a user drags compound state `checkout` into its child `cart`
- **THEN** the move is refused and the text is unchanged

### Requirement: Delete elements
The user SHALL be able to delete states and transitions; deleting a state SHALL delete its descendants and the transitions that target any of them, after showing how many transitions will be removed.

#### Scenario: Delete a targeted state
- **WHEN** a user deletes `review` and two transitions target it
- **THEN** the user is told two transitions will be removed, and after confirming neither remains

### Requirement: Selection and clipboard
The canvas SHALL support single and multiple selection, and copy, cut and paste of states with their internal transitions; pasted ids SHALL be made unique.

#### Scenario: Paste keeps ids unique
- **WHEN** a user copies state `cart` and pastes it into the same chart
- **THEN** the pasted state gets an id other than `cart`

### Requirement: Navigation
The canvas SHALL support pan, zoom, zoom-to-fit, zoom-to-selection, collapsing and expanding compound states, and keyboard navigation between states.

#### Scenario: Collapse a compound state
- **WHEN** a user collapses `checkout`
- **THEN** `checkout` is drawn as one box and transitions into its children are drawn to its border

### Requirement: Rendering performance
With a chart of 1,000 states and 2,000 transitions, pan and zoom SHALL render at 60 frames per second on a mid-range laptop, and highlighting a change of active configuration SHALL update within one frame.

#### Scenario: Large chart pan
- **WHEN** a user pans a 1,000-state chart continuously for five seconds
- **THEN** the median frame time is at most 16.7 ms

### Requirement: Host theming
The canvas SHALL take its colours and fonts from host-provided theme tokens and SHALL follow light, dark and high-contrast themes without reload.

#### Scenario: Theme switch
- **WHEN** the host switches from a light to a dark theme
- **THEN** the canvas redraws in the dark theme without losing selection or viewport

### Requirement: Accessible canvas
Every state and transition SHALL be reachable by keyboard and SHALL expose its kind, id and label to assistive technology.

#### Scenario: Screen reader names a state
- **WHEN** keyboard focus lands on compound state `checkout`
- **THEN** assistive technology announces it as a compound state named `checkout`
