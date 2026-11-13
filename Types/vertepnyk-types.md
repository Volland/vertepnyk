---
tgs: "0.1"
schemas:
  Component:
    properties:
      package: text
      layer: {values: [core, ui, engine, host, tooling]}
      status: {values: [planned, in-progress, stable], default: planned}
    edges:
      provides: [Capability, Requirement]
      uses: Component
      realizes: Decision
      scheduled_in: Milestone
    visualization: {color: "#16a34a", shape: rectangle}
  Milestone:
    properties:
      order: text
      status: {values: [planned, active, done], default: planned}
    edges:
      precedes: Milestone
    visualization: {color: "#db2777", shape: star}
  View:
    properties:
      status: {values: [draft, stable], default: draft}
    edges:
      describes: [Component, Capability, Decision, Requirement, Concept, Milestone, Constraint]
    visualization: {color: "#0891b2", shape: round-tag}
edgeTypes:
  provides:
    from: Component
    to: [Capability, Requirement]
    properties:
      confidence: {values: [full, partial]}
      note: text
  uses:
    from: Component
    to: Component
    properties:
      kind: {values: [required, optional, dev, upstream]}
      note: text
  realizes:
    from: Component
    to: Decision
    properties:
      confidence: {values: [full, partial]}
      note: text
  scheduled_in:
    from: [Component, Capability, Change]
    to: Milestone
    properties:
      note: text
  precedes:
    from: Milestone
    to: Milestone
    properties:
      note: text
  describes:
    from: View
    to: [Component, Capability, Decision, Requirement, Concept, Milestone, Constraint]
    properties:
      note: text
---
# Vertepnyk Ontology

Project types and edges for vertepnyk on top of the bundled code ontology: workspace packages as Components, delivery Milestones, and architecture Views that describe them.

## Questions it answers

Each type earns its place through a query the project asks.

- Which package provides a capability: `MATCH (c:Component)-[:provides]->(k:Capability) RETURN c.title, k.title`.
- What a milestone delivers: `MATCH (x)-[:scheduled_in]->(m:Milestone {title: "M1 Designer core"}) RETURN labels(x), x.title`.
- Which decisions a package realizes, and why: `MATCH (c:Component)-[:realizes]->(d:Decision)-[:motivated_by]->(w) RETURN c.title, d.title, w.title`.
- What we need from vertep: `MATCH (c:Component)-[u:uses {kind: "upstream"}]->(v) RETURN c.title, v.title, u.note`.
