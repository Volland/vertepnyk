---
tgs: "0.4"
schemas:
  Capability:
    description: "An OpenSpec capability: the folder of requirements under openspec/specs/ for one area of behaviour."
    properties:
      status: {values: [draft, stable, deprecated], default: draft}
      owner: text
    visualization: {color: "#0284c7", shape: barrel}
edgeTypes:
  part_of:
    description: This requirement, decision or concept belongs to that group.
    from: [Requirement, Decision, Concept]
    to: [Capability]
    properties: {note: text}
---
# Spec Framework Ontology

Types and edges for the spec frameworks this project uses (OpenSpec), written by `tg init` and rewritten on every run: keep project vocabulary in `Types/code-types.md`.

## How spec nodes are labelled

Every requirement `tg` reads from a spec file keeps the base label the code ontology's edges allow — `Requirement`, `Scenario` or `Decision` — and adds its framework's own label from this note, so `implements` and `verifies` work everywhere and `MATCH (u:UserStory)` finds just the user stories. Type a lat.md section with one of these labels to describe a feature, epic or principle in prose.
