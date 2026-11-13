---
type: Concept
status: draft
---
# Glossary

Terms with one exact meaning in vertepnyk.

## Chart

A statechart in one file, SCXML (`*.scxml`) or vertep YAML (`*.vt.yaml`); the file's text is the chart.

## Layout

Where the chart is drawn: state positions and sizes, transition routes and label positions, collapsed flags. Formatting only; never part of the chart's meaning or hash.

## Configuration

The set of states active at a moment of a run, as vertep reports it in a snapshot.

## Run

One simulation of a chart: an actor in a volatile vertep actor system with a journal, from start or a fork to now.

## Fork

A new run that starts from an earlier step of another run, keeping the original run.

## Host

The program that embeds the designer: the web shell, VS Code, Obsidian or Electron. The host owns the text buffer.
