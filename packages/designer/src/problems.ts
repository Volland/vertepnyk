/**
 * Problems: the controller's diagnostics as a list with the canvas element each concerns, and
 * the map the canvas draws markers from.
 */
import type { ChartModel } from "@vertepnyk/core";
import type { CanvasDiagnostic } from "@vertepnyk/canvas";
import type { Violation } from "@vertepnyk/sim";
import type { DesignerState } from "./controller.js";

export interface ProblemItem {
  readonly key: string;
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
  readonly line?: number;
  readonly column?: number;
  /** The state or transition id (`source#index`) the problem concerns, when known. */
  readonly elementId?: string;
  readonly source: "vertep" | "parse";
}

/** The canvas element a violation names: a transition id when it has one, else a state id. */
export function elementIdOf(v: Violation, model: ChartModel | null, text?: string): string | undefined {
  const t = v.transition;
  if (t) {
    if (t.index !== undefined) {
      const id = `${t.source}#${t.index}`;
      if (!model || model.transitions.has(id)) return id;
    }
    if (model) {
      const own = model.states.get(t.source)?.transitions ?? [];
      const hit = own.find((id) => {
        const tr = model.transitions.get(id);
        return t.event === undefined ? tr?.events.length === 0 : tr?.events.includes(t.event);
      });
      if (hit) return hit;
    }
  }
  if (v.stateId !== undefined && (!model || model.states.has(v.stateId))) return v.stateId;
  if (t?.source !== undefined && (!model || model.states.has(t.source))) return t.source;
  // vertep's SCXML reader gives a line and column but no id: the innermost element there
  if (model && text !== undefined && v.line !== undefined) return elementAt(model, offsetAt(text, v.line, v.column ?? 1));
  return undefined;
}

/** The smallest state or transition whose source span contains `offset`. */
export function elementAt(model: ChartModel, offset: number): string | undefined {
  let best: { id: string; size: number } | undefined;
  const consider = (id: string, span: { start: number; end: number }): void => {
    if (span.start > offset || offset >= span.end) return;
    const size = span.end - span.start;
    if (!best || size < best.size) best = { id, size };
  };
  for (const [id, s] of model.states) consider(id, s.span);
  for (const [id, t] of model.transitions) consider(id, t.span);
  return best?.id;
}

export function problemsOf(state: DesignerState, text?: string): ProblemItem[] {
  const out: ProblemItem[] = [];
  if (state.parseError) {
    out.push({
      key: "parse",
      message: state.parseError.message,
      severity: "error",
      line: state.parseError.line,
      column: state.parseError.column,
      source: "parse",
    });
  }
  if (state.validation.status === "invalid") {
    state.validation.violations.forEach((v, i) => {
      const elementId = elementIdOf(v, state.model, text);
      out.push({
        key: `v${i}`,
        message: v.message,
        severity: v.severity,
        ...(v.line !== undefined ? { line: v.line } : {}),
        ...(v.column !== undefined ? { column: v.column } : {}),
        ...(elementId !== undefined ? { elementId } : {}),
        source: "vertep",
      });
    });
  }
  return out;
}

export function canvasDiagnostics(items: readonly ProblemItem[]): Record<string, CanvasDiagnostic> {
  const out: Record<string, CanvasDiagnostic> = {};
  for (const p of items) {
    if (p.elementId === undefined || out[p.elementId]) continue;
    out[p.elementId] = { severity: p.severity, message: p.message };
  }
  return out;
}

/** Offset of a 1-based line and column in `text`. */
export function offsetAt(text: string, line: number, column: number): number {
  let off = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf("\n", off);
    if (nl < 0) return text.length;
    off = nl + 1;
  }
  return Math.min(text.length, off + Math.max(0, column - 1));
}
