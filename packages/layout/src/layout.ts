/**
 * Automatic layout of a nested statechart with elkjs `layered`.
 *
 * The whole hierarchy goes to ELK as one graph (`INCLUDE_CHILDREN`): compound and parallel
 * states are nested nodes with a header for their name, parallel regions are chained
 * left-to-right by invisible edges, transitions are edges with `event [cond]` labels.
 * When existing layout entries must be kept, ELK's result is used only for the new parts
 * and a post-pass places new states into free space around the fixed ones.
 */
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkLabel, ElkNode, ELK as ElkApi } from "elkjs/lib/elk-api.js";
import type { ChartModel, Command, StateKind, StateLayout, TransitionLayout } from "@vertepnyk/core";

/** The parts of a state that layout reads. */
export interface LayoutState {
  readonly id: string;
  readonly kind: StateKind;
  readonly parent: string | null;
  readonly children: readonly string[];
}

/** The parts of a transition that layout reads. */
export interface LayoutTransition {
  readonly id: string;
  readonly source: string;
  readonly events: readonly string[];
  readonly cond?: string;
  readonly targets: readonly string[];
}

/** The parts of a `ChartModel` that layout reads; every `ChartModel` is one. */
export interface LayoutModel {
  readonly roots: readonly string[];
  readonly states: ReadonlyMap<string, LayoutState>;
  readonly transitions: ReadonlyMap<string, LayoutTransition>;
  readonly layout: ReadonlyMap<string, StateLayout>;
  readonly transitionLayout: ReadonlyMap<string, TransitionLayout>;
}

// Compile-time check that a ChartModel can be laid out directly.
const _chartModelIsLayoutModel = (m: ChartModel): LayoutModel => m;
void _chartModelIsLayoutModel;

export interface LayoutOptions {
  /** A compound or parallel state id: lay out only its descendants. */
  readonly scope?: string;
  /** Default true: states with entries in `model.layout` keep their position and size. */
  readonly keepExisting?: boolean;
  /** Width in px of a label text; defaults to a 13px sans-serif heuristic. */
  readonly measure?: (text: string) => number;
  /** Aborts the layout between phases (ELK itself is not interruptible). */
  readonly signal?: AbortSignal;
}

/**
 * New layout entries. States: relative to the parent's top-left (top-level states: the canvas
 * origin). Transitions: `route` is the absolute polyline from source border to target border
 * (start, bends, end); `label` is the absolute centre of the label box.
 */
export interface LayoutResult {
  readonly states: Record<string, StateLayout>;
  readonly transitions: Record<string, TransitionLayout>;
}

/** Geometry constants, in CSS px at zoom 1. */
export const GEOMETRY = {
  stateMinWidth: 100,
  stateHeight: 40,
  finalMinWidth: 80,
  historySize: 32,
  textPadX: 16,
  headerHeight: 36,
  padding: 16,
  rootPadding: 20,
  nodeGap: 30,
  layerGap: 50,
  regionGap: 24,
  labelHeight: 16,
} as const;

/** About 7.2 px per character of 13px sans-serif. */
export function defaultMeasure(text: string): number {
  return Math.ceil(text.length * 7.2);
}

/** The label text of a transition: `event1 event2 [cond]`; empty when it has neither. */
export function transitionLabel(t: LayoutTransition): string {
  const ev = t.events.join(" ");
  if (t.cond === undefined || t.cond === "") return ev;
  return ev === "" ? `[${t.cond}]` : `${ev} [${t.cond}]`;
}

/** Every text whose width layout measures (state ids and transition labels). */
export function layoutTexts(model: LayoutModel): string[] {
  const out = new Set<string>();
  for (const s of model.states.values()) out.add(s.id);
  for (const t of model.transitions.values()) {
    const l = transitionLabel(t);
    if (l !== "") out.add(l);
  }
  return [...out];
}

/** The core `setLayout` command that writes a layout result into the chart text. */
export function toSetLayoutCommand(result: LayoutResult): Extract<Command, { type: "setLayout" }> {
  return { type: "setLayout", states: { ...result.states }, transitions: { ...result.transitions } };
}

export class LayoutAbortedError extends Error {
  constructor() {
    super("layout aborted");
    this.name = "AbortError";
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Pt = readonly [number, number];

let elkInstance: ElkApi | undefined;
function elk(): ElkApi {
  // The bundled build runs ELK in the calling thread (its "fake worker"): this is what the
  // layout Web Worker wants, and what Node tests use.
  elkInstance ??= new ELK();
  return elkInstance;
}

const nodeId = (id: string): string => `s:${id}`;
const stateOf = (elkId: string): string => elkId.slice(2);

function validEntry(e: StateLayout | undefined): e is StateLayout {
  return (
    e !== undefined &&
    Number.isFinite(e.x) &&
    Number.isFinite(e.y) &&
    Number.isFinite(e.w) &&
    Number.isFinite(e.h) &&
    e.w > 0 &&
    e.h > 0
  );
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new LayoutAbortedError();
}

/**
 * Lays out the chart, or the descendants of `opts.scope`, and returns the new entries.
 * With `keepExisting` (the default) states that have a valid layout entry are not returned
 * and not moved; only new states, and fixed containers that had to grow to hold them, are.
 */
// @tg: implements:: [[openspec:chart-layout#Automatic layout]]
// @tg: implements:: [[openspec:chart-layout#Explicit re-layout]]
export async function computeLayout(model: LayoutModel, opts: LayoutOptions = {}): Promise<LayoutResult> {
  const keepExisting = opts.keepExisting ?? true;
  const measure = opts.measure ?? defaultMeasure;
  const G = GEOMETRY;
  const scope = opts.scope ?? null;
  if (scope !== null && !model.states.has(scope)) throw new Error(`unknown scope state: ${scope}`);

  // --- Visible states in scope ------------------------------------------------------------
  const collapsed = (id: string): boolean => model.layout.get(id)?.collapsed === true;
  const kidsOf = (id: string | null): readonly string[] =>
    (id === null ? model.roots : model.states.get(id)?.children ?? []).filter((c) => model.states.has(c));
  /** Laid-out children: none for a collapsed state. */
  const visibleKids = (id: string | null): readonly string[] =>
    id !== null && collapsed(id) ? [] : kidsOf(id);

  const inScope = new Set<string>();
  const order: string[] = [];
  const walk = (id: string | null): void => {
    for (const c of visibleKids(id)) {
      inScope.add(c);
      order.push(c);
      walk(c);
    }
  };
  walk(scope);

  /** The outermost collapsed ancestor-or-self, which stands in for hidden states. */
  const rep = (id: string): string => {
    let r = id;
    for (let p = model.states.get(id)?.parent ?? null; p !== null; p = model.states.get(p)?.parent ?? null) {
      if (collapsed(p)) r = p;
    }
    return r;
  };
  const parentOf = (id: string): string | null => model.states.get(id)?.parent ?? null;
  /** Container for a state in the ELK graph: its parent, or null for the ELK root. */
  const containerOf = (id: string): string | null => {
    const p = parentOf(id);
    return p === scope ? null : p;
  };
  const isContainer = (id: string): boolean => visibleKids(id).length > 0;

  const existing = (id: string): StateLayout | undefined => {
    if (!keepExisting) return undefined;
    const e = model.layout.get(id);
    return validEntry(e) ? e : undefined;
  };

  // --- Leaf sizes -------------------------------------------------------------------------
  const leafSize = (id: string): { w: number; h: number } => {
    const s = model.states.get(id)!;
    if (s.kind === "history") return { w: G.historySize, h: G.historySize };
    const min = s.kind === "final" ? G.finalMinWidth : G.stateMinWidth;
    return { w: Math.max(min, Math.ceil(measure(id)) + 2 * G.textPadX), h: G.stateHeight };
  };
  const headerMinWidth = (id: string): number => Math.ceil(measure(id)) + 2 * G.textPadX;

  // --- Edges ------------------------------------------------------------------------------
  interface EdgeSpec {
    readonly transition: string;
    readonly index: number;
    readonly from: string;
    readonly to: string;
    readonly label: string;
  }
  const edgesByTransition = new Map<string, EdgeSpec[]>();
  for (const t of model.transitions.values()) {
    if (t.targets.length === 0 || !model.states.has(t.source)) continue;
    const from = rep(t.source);
    if (!inScope.has(from)) continue;
    const specs: EdgeSpec[] = [];
    let inside = true;
    t.targets.forEach((target, index) => {
      if (!model.states.has(target)) return;
      const to = rep(target);
      if (!inScope.has(to)) inside = false;
      specs.push({ transition: t.id, index, from, to, label: specs.length === 0 ? transitionLabel(t) : "" });
    });
    if (inside && specs.length > 0) edgesByTransition.set(t.id, specs);
  }

  // --- ELK graph --------------------------------------------------------------------------
  const elkNodes = new Map<string, ElkNode>();
  const pad = (top: number, side: number): string => `[top=${top},left=${side},bottom=${side},right=${side}]`;
  const build = (id: string): ElkNode => {
    if (!isContainer(id)) {
      const n: ElkNode = { id: nodeId(id), width: leafSize(id).w, height: leafSize(id).h };
      elkNodes.set(id, n);
      return n;
    }
    const n: ElkNode = {
      id: nodeId(id),
      layoutOptions: {
        "elk.padding": pad(G.headerHeight, G.padding),
        "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
        "elk.nodeSize.minimum": `(${headerMinWidth(id)},${G.headerHeight + G.padding})`,
      },
      children: visibleKids(id).map(build),
      edges: [],
    };
    const regions = visibleKids(id);
    if (model.states.get(id)!.kind === "parallel") {
      n.layoutOptions!["elk.spacing.nodeNode"] = String(G.regionGap);
      n.layoutOptions!["elk.layered.spacing.nodeNodeBetweenLayers"] = String(G.regionGap);
      // Invisible chain edges force the regions into consecutive layers: side by side.
      for (let i = 1; i < regions.length; i++) {
        n.edges!.push({ id: `c:${id}:${i}`, sources: [nodeId(regions[i - 1]!)], targets: [nodeId(regions[i]!)] });
      }
    }
    elkNodes.set(id, n);
    return n;
  };
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.json.shapeCoords": "PARENT",
      "elk.padding": scope === null ? pad(G.rootPadding, G.rootPadding) : pad(G.headerHeight, G.padding),
      "elk.spacing.nodeNode": String(G.nodeGap),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(G.layerGap),
      "elk.spacing.edgeLabel": "4",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: visibleKids(scope).map(build),
    edges: [],
  };

  /** Ancestors of a state within the ELK graph, nearest first (excluding the scope). */
  const chain = (id: string): string[] => {
    const out: string[] = [];
    for (let p = containerOf(id); p !== null; p = containerOf(p)) out.push(p);
    return out;
  };
  const edgeContainer = (from: string, to: string): ElkNode => {
    if (from === to) {
      const p = containerOf(from);
      return p === null ? root : elkNodes.get(p)!;
    }
    const fromLine = [from, ...chain(from)];
    const toLine = new Set([to, ...chain(to)]);
    const lca = fromLine.find((a) => toLine.has(a));
    if (lca === undefined) return root;
    // An edge between a container and its descendant lives in the container.
    return elkNodes.get(lca) ?? root;
  };
  const elkEdges = new Map<string, ElkExtendedEdge>();
  for (const specs of edgesByTransition.values()) {
    for (const e of specs) {
      const edge: ElkExtendedEdge = { id: `e:${e.index}:${e.transition}`, sources: [nodeId(e.from)], targets: [nodeId(e.to)] };
      if (e.label !== "") {
        edge.labels = [{ text: e.label, width: Math.ceil(measure(e.label)), height: G.labelHeight }];
      }
      const c = edgeContainer(e.from, e.to);
      (c.edges ??= []).push(edge);
      elkEdges.set(edge.id, edge);
    }
  }

  checkAbort(opts.signal);
  const laid = await elk().layout(root);
  checkAbort(opts.signal);

  // --- Read ELK result --------------------------------------------------------------------
  const elkRect = new Map<string, Rect>();
  const elkRoutes = new Map<string, { route: Pt[]; label?: Pt }>();
  const readNode = (n: ElkNode): void => {
    for (const c of n.children ?? []) {
      elkRect.set(stateOf(c.id), { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
      readNode(c);
    }
    for (const e of n.edges ?? []) {
      if (!e.id.startsWith("e:")) continue;
      const route: Pt[] = [];
      for (const s of e.sections ?? []) {
        for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) {
          const last = route[route.length - 1];
          if (last === undefined || last[0] !== p.x || last[1] !== p.y) route.push([p.x, p.y]);
        }
      }
      const l: ElkLabel | undefined = e.labels?.[0];
      const label: Pt | undefined =
        l !== undefined && l.x !== undefined && l.y !== undefined ? [l.x + (l.width ?? 0) / 2, l.y + (l.height ?? 0) / 2] : undefined;
      elkRoutes.set(e.id, label === undefined ? { route } : { route, label });
    }
  };
  readNode(laid as ElkNode);

  // Absolute origin of the scope's interior (edges come back relative to the ELK root).
  const absOfExisting = (id: string | null): [number, number] => {
    let x = 0;
    let y = 0;
    for (let p = id; p !== null; p = parentOf(p)) {
      const e = model.layout.get(p);
      if (validEntry(e)) {
        x += e.x;
        y += e.y;
      }
    }
    return [x, y];
  };
  const [ox, oy] = absOfExisting(scope);

  const r = (v: number): number => Math.round(v);
  const outState = (id: string, rect: Rect): StateLayout => {
    const c = model.layout.get(id)?.collapsed;
    const base = { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
    return c === undefined ? base : { ...base, collapsed: c };
  };
  const states: Record<string, StateLayout> = {};
  const transitions: Record<string, TransitionLayout> = {};

  const anyExisting = order.some((id) => existing(id) !== undefined);
  if (!anyExisting) {
    // Pure ELK: every state and every transition in scope is new.
    for (const id of order) states[id] = outState(id, elkRect.get(id)!);
    for (const [tid, specs] of edgesByTransition) {
      const first = elkRoutes.get(`e:${specs[0]!.index}:${tid}`);
      if (first === undefined) continue;
      const route = first.route.map(([x, y]) => [r(x + ox), r(y + oy)] as const);
      const tl: TransitionLayout =
        first.label === undefined ? { route } : { route, label: [r(first.label[0] + ox), r(first.label[1] + oy)] as const };
      transitions[tid] = tl;
    }
    return { states, transitions };
  }

  // --- Mixed: keep existing entries, place new states into free space ----------------------
  const rel = new Map<string, Rect>();
  const changed = new Set<string>();
  const fullyFree = new Map<string, boolean>();
  const isFullyFree = (id: string): boolean => {
    let v = fullyFree.get(id);
    if (v === undefined) {
      v = existing(id) === undefined && visibleKids(id).every(isFullyFree);
      fullyFree.set(id, v);
    }
    return v;
  };
  const copyElkSubtree = (id: string): void => {
    for (const c of visibleKids(id)) {
      rel.set(c, { ...elkRect.get(c)! });
      changed.add(c);
      copyElkSubtree(c);
    }
  };

  const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

  /**
   * Places the free children of a container among its fixed ones; returns the content bbox.
   * `bounds` is the inner area of a fixed container; `avoid` are its fixed siblings in its own
   * coordinates, which a growing container should not run into.
   */
  const placeChildren = (
    cid: string | null,
    origin: { left: number; top: number },
    bounds: { right: number; bottom: number } | undefined,
    avoid: readonly Rect[] = [],
  ): { right: number; bottom: number } => {
    const kids = visibleKids(cid);
    const placed: Rect[] = [];
    const free: string[] = [];
    for (const k of kids) {
      const ex = existing(k);
      if (ex !== undefined) placed.push(rel.get(k)!);
      else free.push(k);
    }
    const parallel = cid !== null && model.states.get(cid)!.kind === "parallel";
    const gap = parallel ? G.regionGap : G.nodeGap;
    for (const k of free) {
      const box = rel.get(k)!;
      let best: Rect | undefined;
      if (placed.length === 0) {
        best = { ...box, x: origin.left, y: origin.top };
      } else {
        const cands: [number, number][] = [
          [origin.left, origin.top],
          [origin.left, Math.max(...placed.map((p) => p.y + p.h)) + gap],
          [Math.max(...placed.map((p) => p.x + p.w)) + gap, origin.top],
        ];
        for (const p of placed) cands.push([p.x + p.w + gap, p.y], [p.x, p.y + p.h + gap]);
        if (placed.length <= 40) {
          // Also every alignment with the placed boxes' edges, to find holes.
          const xs = [origin.left, ...placed.flatMap((p) => [p.x, p.x + p.w + gap])];
          const ys = [origin.top, ...placed.flatMap((p) => [p.y, p.y + p.h + gap])];
          for (const x of xs) for (const y of ys) cands.push([x, y]);
        }
        // Parallel regions stay side by side: one row, no horizontal overlap with any region.
        const clash = parallel
          ? (c: Rect, p: Rect): boolean => c.x < p.x + p.w + gap - 0.5 && p.x < c.x + c.w + gap - 0.5
          : (c: Rect, p: Rect): boolean => overlaps(c, p, gap - 0.5);
        const fits = cands
          .map(([x, y]) => ({ ...box, x: Math.max(x, origin.left), y: parallel ? origin.top : Math.max(y, origin.top) }))
          .filter((c) => placed.every((p) => !clash(c, p)));
        const inside =
          bounds === undefined ? [] : fits.filter((c) => c.x + c.w <= bounds.right && c.y + c.h <= bounds.bottom);
        const byReading = (a: Rect, b: Rect): number => a.y - b.y || a.x - b.x;
        if (inside.length > 0) {
          best = inside.sort(byReading)[0];
        } else {
          const minX = Math.min(...placed.map((p) => p.x));
          const minY = Math.min(...placed.map((p) => p.y));
          const maxR = Math.max(...placed.map((p) => p.x + p.w));
          const maxB = Math.max(...placed.map((p) => p.y + p.h));
          const bbox = (c: Rect): number =>
            (Math.max(maxR, c.x + c.w) - Math.min(minX, c.x)) * (Math.max(maxB, c.y + c.h) - Math.min(minY, c.y));
          // Would the container, grown to hold `c`, run into one of its fixed siblings?
          const collides = (c: Rect): number => {
            if (bounds === undefined || avoid.length === 0) return 0;
            const grown: Rect = {
              x: 0,
              y: 0,
              w: Math.max(bounds.right, maxR, c.x + c.w) + G.padding,
              h: Math.max(bounds.bottom, maxB, c.y + c.h) + G.padding,
            };
            return avoid.some((a) => overlaps(grown, a, 0)) ? 1 : 0;
          };
          const scored = fits.map((c) => ({ c, k: collides(c), a: bbox(c) }));
          scored.sort((p, q) => p.k - q.k || p.a - q.a || byReading(p.c, q.c));
          best = scored[0]?.c;
        }
        // Fallback (cannot happen: right of everything always fits).
        best ??= { ...box, x: Math.max(...placed.map((p) => p.x + p.w)) + gap, y: origin.top };
      }
      rel.set(k, best);
      changed.add(k);
      placed.push(best);
    }
    return {
      right: Math.max(origin.left, ...placed.map((p) => p.x + p.w)),
      bottom: Math.max(origin.top, ...placed.map((p) => p.y + p.h)),
    };
  };

  /** Fixes the size of `id` (and the layout of its subtree); position is set by its parent. */
  const resolve = (id: string): void => {
    const ex = existing(id);
    if (ex === undefined && isFullyFree(id)) {
      const er = elkRect.get(id)!;
      rel.set(id, { x: 0, y: 0, w: er.w, h: er.h });
      copyElkSubtree(id);
      return;
    }
    const kids = visibleKids(id);
    for (const k of kids) resolve(k);
    if (ex !== undefined) rel.set(id, { x: ex.x, y: ex.y, w: ex.w, h: ex.h });
    if (kids.length === 0) {
      if (ex === undefined) rel.set(id, { x: 0, y: 0, ...leafSize(id) });
      return;
    }
    const origin = { left: G.padding, top: G.headerHeight };
    const bounds = ex === undefined ? undefined : { right: ex.w - G.padding, bottom: ex.h - G.padding };
    const p = parentOf(id);
    const avoid =
      ex === undefined
        ? []
        : visibleKids(p === scope ? scope : p)
            .filter((sib) => sib !== id && existing(sib) !== undefined)
            .map((sib) => {
              const sr = rel.get(sib) ?? existing(sib)!;
              return { x: sr.x - ex.x, y: sr.y - ex.y, w: sr.w, h: sr.h };
            });
    const content = placeChildren(id, origin, bounds, avoid);
    const w = Math.max(content.right + G.padding, headerMinWidth(id));
    const h = content.bottom + G.padding;
    if (ex === undefined) {
      rel.set(id, { x: 0, y: 0, w, h });
    } else if (w > ex.w || h > ex.h) {
      // A fixed container grows (never moves) to hold its new children.
      rel.set(id, { x: ex.x, y: ex.y, w: Math.max(w, ex.w), h: Math.max(h, ex.h) });
      changed.add(id);
    }
  };

  for (const k of visibleKids(scope)) resolve(k);
  if (scope === null) {
    placeChildren(null, { left: G.rootPadding, top: G.rootPadding }, undefined);
  } else {
    const se = model.layout.get(scope);
    const bounds = validEntry(se) ? { right: se.w - G.padding, bottom: se.h - G.padding } : undefined;
    placeChildren(scope, { left: G.padding, top: G.headerHeight }, bounds);
  }

  for (const id of order) if (changed.has(id)) states[id] = outState(id, rel.get(id)!);

  // Absolute rects for routing.
  const abs = new Map<string, Rect>();
  const absOf = (id: string): Rect => {
    let a = abs.get(id);
    if (a === undefined) {
      const rr = rel.get(id)!;
      const p = parentOf(id);
      const [px, py] = p === scope || p === null ? [ox, oy] : ((q) => [q.x, q.y])(absOf(p));
      a = { x: px + rr.x, y: py + rr.y, w: rr.w, h: rr.h };
      abs.set(id, a);
    }
    return a;
  };
  for (const [tid, specs] of edgesByTransition) {
    const first = specs[0]!;
    const touched = specs.some((e) => changed.has(e.from) || changed.has(e.to));
    if (!touched && model.transitionLayout.has(tid)) continue;
    const route = straightRoute(absOf(first.from), absOf(first.to), first.from === first.to);
    const mid = midpoint(route);
    transitions[tid] = {
      route: route.map(([x, y]) => [r(x), r(y)] as const),
      ...(first.label === "" ? {} : { label: [r(mid[0]), r(mid[1] - G.labelHeight / 2 - 2)] as const }),
    };
  }
  return { states, transitions };
}

/** A straight route between two boxes' borders (or a loop on one box's top-right corner). */
function straightRoute(a: Rect, b: Rect, self: boolean): Pt[] {
  if (self) {
    const x0 = a.x + a.w - 24;
    const y1 = a.y + 12;
    return [
      [x0, a.y],
      [x0, a.y - 20],
      [a.x + a.w + 20, a.y - 20],
      [a.x + a.w + 20, y1],
      [a.x + a.w, y1],
    ];
  }
  const ca: Pt = [a.x + a.w / 2, a.y + a.h / 2];
  const cb: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const inside = (r: Rect, p: Pt): boolean => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  // Container-to-descendant edges: leave from the container's left border.
  if (inside(a, cb) && a.w >= b.w && a.h >= b.h) return [[a.x, cb[1]], [b.x, cb[1]]];
  if (inside(b, ca) && b.w >= a.w && b.h >= a.h) return [[a.x + a.w, ca[1]], [b.x + b.w, ca[1]]];
  return [clip(a, ca, cb), clip(b, cb, ca)];
}

/** The point where the segment from `c` (centre of `r`) towards `to` leaves `r`. */
function clip(r: Rect, c: Pt, to: Pt): Pt {
  const dx = to[0] - c[0];
  const dy = to[1] - c[1];
  if (dx === 0 && dy === 0) return c;
  const tx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty, 1);
  return [c[0] + dx * t, c[1] + dy * t];
}

function midpoint(route: readonly Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]);
  let left = total / 2;
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = route[i - 1]!;
    const [bx, by] = route[i]!;
    const d = Math.hypot(bx - ax, by - ay);
    if (d >= left && d > 0) return [ax + ((bx - ax) * left) / d, ay + ((by - ay) * left) / d];
    left -= d;
  }
  return route[0] ?? [0, 0];
}
