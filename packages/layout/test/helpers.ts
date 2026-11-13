import type { ChartModel, StateKind, StateLayout, StateNode, TransitionLayout, TransitionNode } from "@vertepnyk/core";
import type { LayoutResult } from "../src/index.js";

/** A state in a hand-written test chart. */
export interface S {
  id: string;
  kind?: StateKind;
  children?: S[];
  on?: { event?: string; cond?: string; target?: string | string[] }[];
}

const span = { start: 0, end: 0 };

/** Builds a `ChartModel` from nested state specs. Kind defaults to atomic/compound. */
export function buildModel(
  roots: S[],
  layout: Record<string, StateLayout> = {},
  transitionLayout: Record<string, TransitionLayout> = {},
): ChartModel {
  const states = new Map<string, StateNode>();
  const transitions = new Map<string, TransitionNode>();
  const events = new Set<string>();
  const add = (s: S, parent: string | null): void => {
    const kids = s.children ?? [];
    const kind: StateKind = s.kind ?? (kids.length > 0 ? "compound" : "atomic");
    const tids: string[] = [];
    (s.on ?? []).forEach((t, index) => {
      const id = `${s.id}#${index}`;
      tids.push(id);
      const targets = t.target === undefined ? [] : Array.isArray(t.target) ? t.target : [t.target];
      if (t.event !== undefined) events.add(t.event);
      transitions.set(id, {
        id,
        source: s.id,
        index,
        events: t.event === undefined ? [] : [t.event],
        ...(t.cond === undefined ? {} : { cond: t.cond }),
        targets,
        type: "external",
        actions: [],
        span,
      });
    });
    states.set(s.id, {
      id: s.id,
      kind,
      ...(kind === "history" ? { historyType: "shallow" as const } : {}),
      parent,
      children: kids.map((k) => k.id),
      initial: [],
      initialSource: "implicit",
      transitions: tids,
      onentry: [],
      onexit: [],
      generatedId: false,
      span,
    });
    for (const k of kids) add(k, s.id);
  };
  for (const r of roots) add(r, null);
  return {
    format: "scxml",
    initial: [],
    roots: roots.map((r) => r.id),
    states,
    transitions,
    data: [],
    events: [...events].sort(),
    eventTypes: new Map(),
    layout: new Map(Object.entries(layout)),
    transitionLayout: new Map(Object.entries(transitionLayout)),
  };
}

/** Merges a layout result into a model's layout (what applying `setLayout` would do). */
export function withLayout(model: ChartModel, result: LayoutResult): ChartModel {
  const layout = new Map(model.layout);
  for (const [k, v] of Object.entries(result.states)) layout.set(k, v);
  const transitionLayout = new Map(model.transitionLayout);
  for (const [k, v] of Object.entries(result.transitions)) transitionLayout.set(k, v);
  return { ...model, layout, transitionLayout };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Checks a complete layout (every state of `model` has an entry): no two siblings overlap and
 * every child lies inside its parent's box. Returns the violations.
 */
export function layoutViolations(model: ChartModel, layout: ReadonlyMap<string, StateLayout>): string[] {
  const out: string[] = [];
  const groups: (readonly string[])[] = [model.roots, ...[...model.states.values()].map((s) => s.children)];
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = layout.get(g[i]!);
        const b = layout.get(g[j]!);
        if (a && b && overlap(a, b)) out.push(`siblings overlap: ${g[i]} ${g[j]}`);
      }
    }
  }
  for (const s of model.states.values()) {
    const e = layout.get(s.id);
    if (!e) {
      out.push(`no layout: ${s.id}`);
      continue;
    }
    if (!(e.w > 0 && e.h > 0)) out.push(`empty box: ${s.id}`);
    if (s.parent !== null) {
      const p = layout.get(s.parent);
      if (p && (e.x < 0 || e.y < 0 || e.x + e.w > p.w || e.y + e.h > p.h)) {
        out.push(`outside parent: ${s.id} in ${s.parent}`);
      }
    }
  }
  return out;
}

/** A deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generated chart with about `n` states: nested compounds up to three levels, some parallel
 * states, history and final states, chain transitions in each container plus random jumps.
 */
export function generateChart(n: number, seed = 1): S[] {
  const rand = rng(seed);
  let count = 0;
  const all: S[] = [];
  const make = (depth: number, prefix: string): S => {
    const id = `${prefix}${count++}`;
    const s: S = { id };
    all.push(s);
    const r = rand();
    if (depth < 3 && count < n && r < 0.35) {
      const parallel = r < 0.07;
      s.kind = parallel ? "parallel" : "compound";
      const k = parallel ? 2 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 5);
      s.children = [];
      for (let i = 0; i < k && count < n; i++) s.children.push(make(depth + 1, parallel ? "r" : "s"));
      if (!parallel && count < n && rand() < 0.3) {
        s.children.push({ id: `h${count++}`, kind: "history" });
      }
    }
    return s;
  };
  const roots: S[] = [];
  while (count < n) roots.push(make(0, "t"));
  // Chain transitions between siblings, plus some random cross-hierarchy jumps.
  const link = (sibs: S[]): void => {
    for (let i = 0; i + 1 < sibs.length; i++) {
      const a = sibs[i]!;
      if (a.kind === "history") continue;
      (a.on ??= []).push({ event: `e${i}`, target: sibs[i + 1]!.id });
    }
    for (const s of sibs) if (s.children && s.kind !== "parallel") link(s.children);
    for (const s of sibs) if (s.children && s.kind === "parallel") for (const r of s.children) if (r.children) link(r.children);
  };
  link(roots);
  for (let i = 0; i < n / 10; i++) {
    const a = all[Math.floor(rand() * all.length)]!;
    const b = all[Math.floor(rand() * all.length)]!;
    if (a.kind === "history") continue;
    (a.on ??= []).push({ event: `jump${i}`, cond: rand() < 0.5 ? "x > 1" : undefined, target: b.id });
  }
  return roots;
}
