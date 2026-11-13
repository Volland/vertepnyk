## Purpose

Driving a chart without code: run it on vertep's interpreter, send events, watch the active configuration and context change, and travel back and forth through the run.

## ADDED Requirements

### Requirement: Simulation runs on the vertep interpreter
A simulation SHALL execute the current chart text on vertep's WebAssembly interpreter with volatile in-memory storage, so every step follows W3C SCXML semantics as vertep implements them; the designer SHALL NOT compute transitions itself.

#### Scenario: Conflict resolution matches vertep
- **WHEN** an event enables transitions in a child and its ancestor
- **THEN** the simulation takes the transition vertep takes, the child's

### Requirement: Start and reset
The user SHALL be able to start a simulation of a chart that has no validation errors, and to reset it to the initial configuration; a chart with errors SHALL NOT start and SHALL show why.

#### Scenario: Start shows the initial configuration
- **WHEN** a user starts the order chart
- **THEN** state `idle` is highlighted as active

#### Scenario: Invalid chart does not start
- **WHEN** a user starts a chart with an unknown transition target
- **THEN** the simulation does not start and the violation is shown

### Requirement: Active configuration is highlighted
During a simulation every state in the active configuration SHALL be highlighted on the canvas, and the transitions taken by the last macrostep SHALL be marked.

#### Scenario: Highlight after an event
- **WHEN** the order chart is in `idle` and the user sends `start`
- **THEN** `checkout` and `cart` are highlighted, `idle` is not, and the `start` transition is marked as taken

### Requirement: Enabled events are offered
The designer SHALL list the events that would enable a transition in the current configuration, as determined by vertep, and SHALL also allow sending any event name.

#### Scenario: Enabled events in cart
- **WHEN** the order chart is in `checkout.cart`
- **THEN** `pay` and `cancel` are offered as enabled events

### Requirement: Send events with payload
The user SHALL be able to send an event with a JSON payload; for typed charts the payload SHALL be checked against the event's declared type before sending.

#### Scenario: Guard uses the payload
- **WHEN** in `cart` the user sends `pay` with payload `{"amount": 0}`
- **THEN** the configuration stays in `cart` because the guard is false

#### Scenario: Ill-typed payload is refused
- **WHEN** in a typed chart the user sends `pay` with payload `{"amount": "ten"}` and `amount` is a decimal
- **THEN** the event is not sent and the type error is shown

### Requirement: Context is shown
The designer SHALL show the chart's context (datamodel values) after every macrostep, and SHALL mark values that changed in the last step.

#### Scenario: Assign shows in context
- **WHEN** in `cart` the user sends `pay` with payload `{"amount": 150}`
- **THEN** the context shows `total` as `150`, marked as changed

### Requirement: Event log
The designer SHALL keep a log of the run: each macrostep with its event, payload, transitions taken and resulting configuration, including internal and raised events.

#### Scenario: Raised event appears in the log
- **WHEN** a transition's action raises `checked`
- **THEN** the log shows `checked` as an internal event in the same macrostep

### Requirement: Time travel
The user SHALL be able to move to any earlier macrostep of the run and see that step's configuration and context, to step forward again, and to fork a new run from any earlier step; sending an event from an earlier step SHALL fork rather than discard the later steps silently.

#### Scenario: Step back
- **WHEN** after three macrosteps the user moves back one step
- **THEN** the canvas and context show the state after the second macrostep

#### Scenario: Fork from the past
- **WHEN** the user moves back to step one and sends `cancel`
- **THEN** a new run branches from step one and the original run remains available

### Requirement: Live edits during simulation
Editing the chart during a simulation SHALL mark the simulation as stale and offer to restart it, replaying the run's external events on the edited chart.

#### Scenario: Replay on edit
- **WHEN** during a three-event run the user changes a guard and chooses replay
- **THEN** the same three events are sent to the edited chart from its initial configuration

### Requirement: Final state ends the run
When the chart reaches a top-level final state the designer SHALL show the run as done with its done data, and SHALL refuse further events until reset or time travel.

#### Scenario: Reach paid
- **WHEN** the order chart enters `paid`
- **THEN** the run is shown as done
