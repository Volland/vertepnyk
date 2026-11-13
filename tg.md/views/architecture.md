---
type: View
status: draft
---
# Architecture View

How vertepnyk is put together: one host-independent designer over a format-preserving document model and vertep's WebAssembly interpreter, mounted by four thin hosts.

- describes:: [[components#core]]
- describes:: [[components#sim]]
- describes:: [[components#designer]]
- describes:: [[components#host-bridge]]
- describes:: [[decisions#The text file is the source of truth]]
- describes:: [[decisions#vertep WASM is the only interpreter]]
- describes:: [[decisions#Hosts are thin adapters over one core]]

## Packages and hosts

Hosts mount `designer` through the host bridge; the designer composes canvas, inspector and sim over core; sim is the only package that talks to vertep.

```mermaid
flowchart TB
    subgraph Hosts
        WS[web-shell]
        VS[vscode]
        OB[obsidian]
        EL[electron]
    end
    HB[host-bridge]
    D[designer]
    C[canvas]
    I[inspector]
    S[sim]
    L[layout worker]
    K[core]
    V["@vertep/web WASM worker"]
    WS --> HB
    VS --> HB
    OB --> HB
    EL --> WS
    HB --> D
    D --> C
    D --> I
    D --> S
    C --> L
    C --> K
    I --> K
    S --> K
    S --> V
```

## One edit, end to end

A visual edit becomes a text patch the host applies; the new text flows back as the single source of truth to every view and to vertep.

```mermaid
sequenceDiagram
    participant U as User
    participant C as canvas
    participant K as core
    participant H as host buffer
    participant S as sim
    participant V as vertep WASM
    U->>C: drag transition target
    C->>K: retarget command
    K->>H: minimal text patch
    H-->>K: text changed
    K-->>C: semantic view updated
    K->>S: debounced text
    S->>V: register in scratch system
    V-->>S: version IRI or violations
    S-->>C: diagnostics
```

## Simulation and time travel

A run is an actor in a volatile vertep system with a journal; the canvas renders snapshots, and time travel reads earlier snapshots with `asOf`.

```mermaid
flowchart LR
    E[event + payload] --> A[run actor]
    A --> J[journal]
    A --> N[snapshot and transitions]
    N --> H[highlight configuration]
    J --> T[asOf step n]
    T --> H
    T --> F[fork new run]
```
