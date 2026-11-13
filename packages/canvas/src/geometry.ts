/**
 * Pure scene geometry: resolves every state's layout (stored or provisional), absolute
 * rectangles, collapsed subtrees and the routes of transitions. No DOM, no Solid.
 */
import type { ChartModel, StateKind, StateLayout, TransitionNode } from "@vertepnyk/core";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export type Pt = readonly [number, number];

export const HEADER = 36;
export const PAD = 16;
export const COLLAPSED_H = 40;
export const ROOT_ORIGIN = 20;

export function isContainer(kind: StateKind): boolean {
  return kind === "compound" || kind === "parallel";
}

export function defaultSize(kind: StateKind): { w: number; h: number } {
  switch (kind) {
    case "final":
      return { w: 80, h: 40 };
    case "history":
      return { w: 32, h: 32 };
    case "compound":
      return { w: 200, h: 120 };
    case "parallel":
      return { w: 280, h: 140 };
    default:
      return { w: 120, h: 40 };
  }
}

export interface Scene {
  /** Absolute rectangles of the visible states. */
  readonly rects: Map<string, Rect>;
  /** Resolved layout relative to the parent, for every state (stored or provisional). */
  readonly rel: Map<string, StateLayout>;
  /** Visible states, parents before children. */
  readonly order: string[];
  /** Visible children of a state (null: roots), in document order. */
  readonly kids: Map<string | null, string[]>;
  /** Collapsed compound or parallel states. */
  readonly collapsed: Set<string>;
  /** Hidden state -> the collapsed ancestor that stands for it. */
  readonly hiddenBy: Map<string, string>;
  /** States drawn at a provisional position (no layout entry). */
  readonly provisional: Set<string>;
  readonly bounds: Rect | null;
}

export const EMPTY_SCENE: Scene = {
  rects: new Map(),
  rel: new Map(),
  order: [],
  kids: new Map(),
  collapsed: new Set(),
  hiddenBy: new Map(),
  provisional: new Set(),
  bounds: null,
};

/** The visible representative of a state: itself, or the collapsed ancestor hiding it. */
export function proxyOf(scene: Scene, id: string): string | undefined {
  if (scene.rects.has(id)) return id;
  return scene.hiddenBy.get(id);
}

export function computeScene(model: ChartModel, override?: ReadonlyMap<string, StateLayout>): Scene {
  const rel = new Map<string, StateLayout>();
  const provisional = new Set<string>();
  const own = (id: string): StateLayout | undefined => override?.get(id) ?? model.layout.get(id);

  const measure = (id: string): { w: number; h: number } => {
    const st = model.states.get(id)!;
    const d = defaultSize(st.kind);
    if (isContainer(st.kind) && st.children.length > 0) {
      resolve(id, st.children);
      let right = 0;
      let bottom = 0;
      for (const c of st.children) {
        const r = rel.get(c)!;
        right = Math.max(right, r.x + r.w);
        bottom = Math.max(bottom, r.y + r.h);
      }
      return { w: Math.max(d.w, right + PAD), h: Math.max(d.h, bottom + PAD) };
    }
    return d;
  };

  const resolve = (parentId: string | null, ids: readonly string[]): void => {
    const missing: string[] = [];
    let bottom = 0;
    for (const id of ids) {
      const l = own(id);
      if (l) {
        rel.set(id, l);
        bottom = Math.max(bottom, l.y + l.h);
        const st = model.states.get(id)!;
        if (st.children.length > 0) resolve(id, st.children);
      } else missing.push(id);
    }
    if (missing.length === 0) return;
    const parent = parentId === null ? null : model.states.get(parentId)!;
    const sizes = missing.map((id) => measure(id));
    const maxW = Math.max(...sizes.map((s) => s.w));
    const maxH = Math.max(...sizes.map((s) => s.h));
    const cols = parent?.kind === "parallel" ? missing.length : Math.max(1, Math.ceil(Math.sqrt(missing.length)));
    const ox = parentId === null ? ROOT_ORIGIN : PAD;
    const base = parentId === null ? ROOT_ORIGIN : HEADER + 8;
    const oy = bottom > 0 ? Math.max(base, bottom + 30) : base;
    missing.forEach((id, i) => {
      const s = sizes[i]!;
      rel.set(id, { x: ox + (i % cols) * (maxW + 30), y: oy + Math.floor(i / cols) * (maxH + 30), w: s.w, h: s.h });
      provisional.add(id);
    });
  };
  resolve(null, model.roots);

  const rects = new Map<string, Rect>();
  const order: string[] = [];
  const kids = new Map<string | null, string[]>();
  const collapsed = new Set<string>();
  const hiddenBy = new Map<string, string>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const hide = (id: string, by: string): void => {
    for (const c of model.states.get(id)!.children) {
      hiddenBy.set(c, by);
      hide(c, by);
    }
  };
  const place = (id: string, parent: string | null, ox: number, oy: number): void => {
    const st = model.states.get(id)!;
    const r = rel.get(id)!;
    const isCollapsed = r.collapsed === true && isContainer(st.kind) && st.children.length > 0;
    const abs: Rect = { x: ox + r.x, y: oy + r.y, w: r.w, h: isCollapsed ? COLLAPSED_H : r.h };
    rects.set(id, abs);
    order.push(id);
    let list = kids.get(parent);
    if (!list) kids.set(parent, (list = []));
    list.push(id);
    minX = Math.min(minX, abs.x);
    minY = Math.min(minY, abs.y);
    maxX = Math.max(maxX, abs.x + abs.w);
    maxY = Math.max(maxY, abs.y + abs.h);
    if (isCollapsed) {
      collapsed.add(id);
      hide(id, id);
      return;
    }
    for (const c of st.children) place(c, id, abs.x, abs.y);
  };
  for (const id of model.roots) place(id, null, 0, 0);

  const bounds = order.length === 0 ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  return { rects, rel, order, kids, collapsed, hiddenBy, provisional, bounds };
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** The deepest visible state under a world point, optionally only containers, skipping `exclude`. */
export function stateAt(
  model: ChartModel,
  scene: Scene,
  x: number,
  y: number,
  opts: { containersOnly?: boolean; exclude?: ReadonlySet<string> } = {},
): string | null {
  for (let i = scene.order.length - 1; i >= 0; i--) {
    const id = scene.order[i]!;
    if (opts.exclude?.has(id)) continue;
    const st = model.states.get(id);
    if (!st) continue;
    if (opts.containersOnly && (!isContainer(st.kind) || scene.collapsed.has(id))) continue;
    if (contains(scene.rects.get(id)!, x, y)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface EdgeInfo {
  readonly id: string;
  /** One polyline per target. */
  readonly parts: readonly (readonly Pt[])[];
  readonly label: string;
  readonly labelPos: Pt;
  readonly eventless: boolean;
  readonly bbox: Rect;
}

export function edgeLabel(t: TransitionNode): string {
  const ev = t.events.join(" ");
  const cond = t.cond === undefined || t.cond === "" ? "" : `[${t.cond}]`;
  if (ev === "") return cond === "" ? "∅" : `∅ ${cond}`;
  return cond === "" ? ev : `${ev} ${cond}`;
}

function center(r: Rect): Pt {
  return [r.x + r.w / 2, r.y + r.h / 2];
}

/** Where the ray from the rectangle's centre toward `p` leaves the rectangle. */
export function borderToward(r: Rect, p: Pt): Pt {
  const [cx, cy] = center(r);
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  if (dx === 0 && dy === 0) return [cx, r.y];
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const t = Math.min(sx, sy);
  return [cx + dx * t, cy + dy * t];
}

function distToBorder(r: Rect, p: Pt): number {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.w));
  const dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p[0] - r.x, r.x + r.w - p[0], p[1] - r.y, r.y + r.h - p[1]);
}

function inside(outer: Rect, p: Pt): boolean {
  return contains(outer, p[0], p[1]);
}

function straight(a: Rect, b: Rect): Pt[] {
  const cb = center(b);
  const ca = center(a);
  if (inside(a, cb)) return [[cb[0], a.y + a.h], [cb[0], b.y + b.h]];
  if (inside(b, ca)) return [[ca[0], a.y], [ca[0], b.y]];
  return [borderToward(a, cb), borderToward(b, ca)];
}

function loop(r: Rect): Pt[] {
  const x = r.x + r.w;
  const y1 = r.y + r.h * 0.3;
  const y2 = r.y + r.h * 0.7;
  return [[x, y1], [x + 26, y1], [x + 26, y2], [x, y2]];
}

function polyMid(pts: readonly Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  let walk = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walk <= len && len > 0) return [a[0] + ((b[0] - a[0]) * walk) / len, a[1] + ((b[1] - a[1]) * walk) / len];
    walk -= len;
  }
  return pts[0] ?? [0, 0];
}

/** Routes of every drawn transition (targetless ones are drawn on their source and are not edges). */
export function computeEdges(model: ChartModel, scene: Scene): Map<string, EdgeInfo> {
  const out = new Map<string, EdgeInfo>();
  for (const t of model.transitions.values()) {
    if (t.targets.length === 0) continue;
    const sId = proxyOf(scene, t.source);
    const sRect = sId === undefined ? undefined : scene.rects.get(sId);
    if (sId === undefined || !sRect) continue;
    const saved = model.transitionLayout.get(t.id);
    const parts: Pt[][] = [];
    let labelPos: Pt | null = null;
    t.targets.forEach((target, i) => {
      const tId = proxyOf(scene, target);
      const tRect = tId === undefined ? undefined : scene.rects.get(tId);
      if (tId === undefined || !tRect) return;
      if (tId === sId && (sId !== t.source || tId !== target)) return;
      let pts: Pt[];
      const route = saved?.route;
      if (
        i === 0 &&
        route &&
        route.length >= 2 &&
        sId === t.source &&
        tId === target &&
        distToBorder(sRect, route[0]!) < 3 &&
        distToBorder(tRect, route[route.length - 1]!) < 3
      ) {
        pts = route.map((p) => [p[0], p[1]] as Pt);
        if (saved?.label) labelPos = saved.label;
      } else if (tId === sId) pts = loop(sRect);
      else pts = straight(sRect, tRect);
      if (labelPos === null && parts.length === 0) labelPos = polyMid(pts);
      parts.push(pts);
    });
    if (parts.length === 0) continue;
    const label = edgeLabel(t);
    const lp: Pt = labelPos ?? [0, 0];
    let x0 = lp[0] - label.length * 3.6;
    let x1 = lp[0] + label.length * 3.6;
    let y0 = lp[1] - 14;
    let y1 = lp[1] + 6;
    for (const p of parts) for (const q of p) {
      x0 = Math.min(x0, q[0]);
      x1 = Math.max(x1, q[0]);
      y0 = Math.min(y0, q[1]);
      y1 = Math.max(y1, q[1]);
    }
    out.set(t.id, { id: t.id, parts, label, labelPos: [lp[0], lp[1] - 6], eventless: t.events.length === 0, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
  }
  return out;
}

const f = (n: number): string => String(Math.round(n * 10) / 10);

/** A polyline with rounded corners as an SVG path. */
export function smoothPath(pts: readonly Pt[], radius = 8): string {
  if (pts.length < 2) return "";
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const r1 = Math.min(radius, l1 / 2);
    const r2 = Math.min(radius, l2 / 2);
    if (l1 === 0 || l2 === 0) continue;
    const a: Pt = [c[0] + ((p[0] - c[0]) / l1) * r1, c[1] + ((p[1] - c[1]) / l1) * r1];
    const b: Pt = [c[0] + ((n[0] - c[0]) / l2) * r2, c[1] + ((n[1] - c[1]) / l2) * r2];
    d += `L${f(a[0])} ${f(a[1])}Q${f(c[0])} ${f(c[1])} ${f(b[0])} ${f(b[1])}`;
  }
  const last = pts[pts.length - 1]!;
  return d + `L${f(last[0])} ${f(last[1])}`;
}

/** The dot-and-arrow of an initial transition into `target`. */
export function initialArrow(target: Rect): { dot: Pt; d: string } {
  const cx = target.x + target.w / 2;
  const dot: Pt = [cx, target.y - 26];
  return { dot, d: `M${f(cx)} ${f(target.y - 22)}L${f(cx)} ${f(target.y)}` };
}
