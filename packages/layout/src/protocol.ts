/** Messages between the layout client (UI thread) and the layout worker. */
import type { LayoutModel, LayoutResult, LayoutState, LayoutTransition } from "./layout.js";

/** A layout request. `widths` carries label widths measured on the UI thread. */
export interface LayoutRequest {
  readonly type: "layout";
  readonly id: number;
  readonly model: LayoutModel;
  readonly scope?: string;
  readonly keepExisting?: boolean;
  readonly widths?: Readonly<Record<string, number>>;
}

export type LayoutResponse =
  | { readonly id: number; readonly ok: true; readonly result: LayoutResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * A structured-clone-safe copy of the parts of a model layout reads: plain objects and Maps
 * only, whatever class the caller's model is built from.
 */
export function toWireModel(model: LayoutModel): LayoutModel {
  const states = new Map<string, LayoutState>();
  for (const [k, s] of model.states) {
    states.set(k, { id: s.id, kind: s.kind, parent: s.parent, children: [...s.children] });
  }
  const transitions = new Map<string, LayoutTransition>();
  for (const [k, t] of model.transitions) {
    const base = { id: t.id, source: t.source, events: [...t.events], targets: [...t.targets] };
    transitions.set(k, t.cond === undefined ? base : { ...base, cond: t.cond });
  }
  return {
    roots: [...model.roots],
    states,
    transitions,
    layout: new Map([...model.layout].map(([k, v]) => [k, { ...v }])),
    transitionLayout: new Map(
      [...model.transitionLayout].map(([k, v]) => [
        k,
        {
          ...(v.route === undefined ? {} : { route: v.route.map((p) => [p[0], p[1]] as const) }),
          ...(v.label === undefined ? {} : { label: [v.label[0], v.label[1]] as const }),
        },
      ]),
    ),
  };
}
