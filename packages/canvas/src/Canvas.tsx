/**
 * The statechart canvas: a Solid component that draws a `ChartDocument` as SVG and edits it
 * through core commands. See `CanvasProps` for the host contract and `CanvasApi` for the
 * imperative handle.
 */
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import { EditError, uniqueId, type ChartDocument, type ChartModel, type Command, type StateKind, type StateLayout } from "@vertepnyk/core";
import { LayoutCancelledError, toSetLayoutCommand, type LayoutClient } from "@vertepnyk/layout";
import type { ThemeTokens } from "@vertepnyk/host-bridge";
import {
  COLLAPSED_H,
  EMPTY_SCENE,
  HEADER,
  borderToward,
  computeEdges,
  computeScene,
  contains,
  defaultSize,
  intersects,
  isContainer,
  smoothPath,
  stateAt,
  type EdgeInfo,
  type Pt,
  type Rect,
  type Scene,
} from "./geometry.js";
import { arrEq, type CanvasDiagnostic, type Ctx, type InitialInfo } from "./ctx.js";
import { CANVAS_CSS, themeVars } from "./styles.js";
import { EdgeView, InitialView, StateView } from "./views.jsx";
import { copySelection, deleteCommands, deleteImpact, parseClipboard, pasteSelection, serializeClipboard, type ClipboardPayload, type DeleteInfo } from "./clipboard.js";

export type { CanvasDiagnostic, Severity } from "./ctx.js";
export type { DeleteInfo } from "./clipboard.js";

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export type DiagnosticMap = ReadonlyMap<string, CanvasDiagnostic> | Readonly<Record<string, CanvasDiagnostic>>;

export interface ContextMenuInfo {
  /** Client coordinates of the event. */
  readonly clientX: number;
  readonly clientY: number;
  /** Position in chart coordinates. */
  readonly world: { readonly x: number; readonly y: number };
  readonly state?: string;
  readonly transition?: string;
}

export interface CanvasApi {
  fit(): void;
  zoomToSelection(): void;
  zoomBy(factor: number): void;
  centerOn(id: string): void;
  getViewport(): Viewport;
  /** The canvas as a standalone SVG document (every element, regardless of culling). */
  exportSvg(): string;
  /** Lays out `scope` (default: the whole chart) from scratch through the layout client. */
  relayout(scope?: string): Promise<void>;
  /** Creates a state; at `at` (chart coordinates, default: the view centre) under `parent` (default: the container there). Returns its id. */
  createState(kind: StateKind, opts?: { at?: { x: number; y: number }; parent?: string | null; historyType?: "shallow" | "deep" }): string | null;
  deleteSelection(): Promise<boolean>;
  copy(): Promise<void>;
  cut(): Promise<void>;
  paste(): Promise<void>;
  setInitial(id: string): boolean;
  toggleCollapse(id: string): boolean;
  /** Starts the inline editor of a state's id. */
  rename(id: string): void;
}

export interface CanvasProps {
  doc: ChartDocument;
  theme: ThemeTokens;
  layoutClient?: LayoutClient;
  /** Active state ids (simulation highlight). */
  active?: ReadonlySet<string>;
  /** Transition ids (`source#index`) taken by the viewed step. */
  taken?: ReadonlySet<string>;
  diagnostics?: DiagnosticMap;
  readOnly?: boolean;
  /** Show the built-in toolbar (default true). */
  toolbar?: boolean;
  /** Selected state and transition ids (controlled). */
  selection?: readonly string[];
  onSelectionChange?: (ids: readonly string[]) => void;
  /** Persistable view state (controlled). */
  viewport?: Viewport;
  onViewportChange?: (v: Viewport) => void;
  /** The user asked to see an element in the text (context menu, Ctrl/Cmd+Enter). */
  onRevealRequest?: (id: string) => void;
  /** A command was refused (`EditError`) or layout failed; the text is unchanged. */
  onError?: (message: string, error: Error) => void;
  /** A transition was drawn: the host can focus its details (event, guard). */
  onRequestTransitionDetails?: (id: string) => void;
  /** Asked before deleting; default: delete. */
  confirmDelete?: (info: DeleteInfo) => boolean | Promise<boolean>;
  /** F2 or double-click on a label; return false to suppress the built-in inline editor. */
  onRenameRequest?: (id: string) => boolean | void;
  /** Replaces the built-in context menu. */
  onContextMenu?: (info: ContextMenuInfo) => void;
  apiRef?: (api: CanvasApi) => void;
}

let counter = 0;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Gesture =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; ids: string[]; start: Pt; moved: boolean; additive: boolean; wasSelected: boolean; key: string }
  | { kind: "resize"; id: string; start: Pt; key: string; moved: boolean }
  | { kind: "draw"; from: string; start: Pt; moved: boolean }
  | { kind: "retarget"; tid: string; end: "source" | "target"; index: number; start: Pt; moved: boolean }
  | { kind: "marquee"; start: Pt; base: ReadonlySet<string>; moved: boolean };

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly world: Pt;
  readonly state?: string;
  readonly transition?: string;
}

// @tg: implements:: [[openspec:canvas-editing#Every SCXML state kind is drawn]]
// @tg: implements:: [[openspec:canvas-editing#Create states]]
// @tg: implements:: [[openspec:canvas-editing#Create and retarget transitions]]
// @tg: implements:: [[openspec:canvas-editing#Reparent states]]
// @tg: implements:: [[openspec:canvas-editing#Delete elements]]
// @tg: implements:: [[openspec:canvas-editing#Selection and clipboard]]
// @tg: implements:: [[openspec:canvas-editing#Navigation]]
// @tg: implements:: [[openspec:canvas-editing#Rendering performance]] {confidence: partial}
// @tg: implements:: [[openspec:canvas-editing#Host theming]]
// @tg: implements:: [[openspec:canvas-editing#Accessible canvas]]
export function Canvas(props: CanvasProps): JSX.Element {
  const uid = `vt${++counter}`;
  let root!: HTMLDivElement;
  let svg!: SVGSVGElement;
  let renameInput: HTMLInputElement | undefined;
  let gesture: Gesture | null = null;
  let space = false;
  let dragCounter = 0;
  let clipboardMemory: ClipboardPayload | null = null;

  // ---- model ---------------------------------------------------------------------------
  const [model, setModel] = createSignal<ChartModel | null>(props.doc.model);
  createEffect(() => {
    const d = props.doc;
    setModel(d.model);
    const off = d.onChange((c) => setModel(c.model));
    onCleanup(off);
  });

  // ---- view state ----------------------------------------------------------------------
  const [vp, setVp] = createSignal<Viewport>(props.viewport ?? { x: 0, y: 0, zoom: 1 });
  createEffect(on(() => props.viewport, (v) => v && setVp(v), { defer: true }));
  const setViewport = (v: Viewport): void => {
    setVp(v);
    props.onViewportChange?.(v);
  };
  const [size, setSize] = createSignal({ w: 800, h: 600 });
  const [sel, setSel] = createSignal<ReadonlySet<string>>(new Set(props.selection ?? []));
  createEffect(() => {
    const s = props.selection;
    if (s) setSel(new Set(s));
  });
  const setSelection = (ids: Iterable<string>): void => {
    const next = new Set(ids);
    const cur = untrack(sel);
    if (next.size === cur.size && [...next].every((i) => cur.has(i))) return;
    setSel(next);
    props.onSelectionChange?.([...next]);
  };
  const [focusId, setFocusId] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<{ override: Map<string, StateLayout>; drop: string | null } | null>(null);
  const [draft, setDraft] = createSignal<{ from: string; to: Pt } | null>(null);
  const [marquee, setMarquee] = createSignal<Rect | null>(null);
  const [cullOff, setCullOff] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  const [edit, setEdit] = createSignal<{ id: string } | null>(null);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [kick, setKick] = createSignal(0);

  // ---- scene ---------------------------------------------------------------------------
  const baseScene = createMemo<Scene>(() => {
    const m = model();
    return m ? computeScene(m) : EMPTY_SCENE;
  });
  const scene = createMemo<Scene>(() => {
    const d = drag();
    const m = model();
    return d && m ? computeScene(m, d.override) : baseScene();
  });
  const edges = createMemo<Map<string, EdgeInfo>>(() => {
    const m = model();
    return m ? computeEdges(m, scene()) : new Map();
  });
  const initials = createMemo<Map<string, InitialInfo>>(() => {
    const m = model();
    const sc = scene();
    const out = new Map<string, InitialInfo>();
    if (!m) return out;
    const add = (owner: string | null, target: string): void => {
      const tgt = sc.rects.has(target) ? target : sc.hiddenBy.get(target);
      if (tgt !== undefined) out.set(`${owner ?? "#"}>${target}`, { key: `${owner ?? "#"}>${target}`, target: tgt });
    };
    for (const t of m.initial.length > 0 ? m.initial : m.roots.slice(0, 1)) add(null, t);
    for (const id of sc.order) {
      const st = m.states.get(id)!;
      if (st.kind !== "compound" || sc.collapsed.has(id)) continue;
      const targets = st.initial.length > 0 ? st.initial : st.children.filter((c) => m.states.get(c)?.kind !== "history").slice(0, 1);
      for (const t of targets) add(id, t);
    }
    return out;
  });

  // Provisional layout: ask the layout client for states without entries.
  let inFlight = false;
  let lastKey = "";
  createEffect(() => {
    kick();
    const m = model();
    const client = props.layoutClient;
    if (!m || !client || props.readOnly) return;
    const missing = [...m.states.keys()].filter((i) => !m.layout.has(i));
    if (missing.length === 0) {
      lastKey = "";
      return;
    }
    const key = missing.join(",");
    if (inFlight || key === lastKey) return;
    lastKey = key;
    inFlight = true;
    const text = props.doc.text;
    client.layout(m, { keepExisting: true }).then(
      (res) => {
        inFlight = false;
        if (props.doc.text !== text) {
          lastKey = "";
          setKick((k) => k + 1);
          return;
        }
        run(toSetLayoutCommand(res), "layout");
      },
      (e: unknown) => {
        inFlight = false;
        if (e instanceof LayoutCancelledError) {
          lastKey = "";
          setKick((k) => k + 1);
        } else report(e);
      },
    );
  });

  // Selection never keeps ids of elements that are gone.
  createEffect(() => {
    const m = model();
    if (!m) return;
    const cur = untrack(sel);
    const keep = [...cur].filter((i) => m.states.has(i) || m.transitions.has(i));
    if (keep.length !== cur.size) setSelection(keep);
    const f = untrack(focusId);
    if (f !== null && !m.states.has(f) && !m.transitions.has(f)) setFocusId(null);
  });

  // ---- culling -------------------------------------------------------------------------
  const viewRect = createMemo<Rect>(() => {
    const v = vp();
    const s = size();
    const m = 120 / v.zoom;
    return { x: -v.x / v.zoom - m, y: -v.y / v.zoom - m, w: s.w / v.zoom + 2 * m, h: s.h / v.zoom + 2 * m };
  });
  const roving = createMemo<string | null>(() => {
    const f = focusId();
    const m = model();
    if (f !== null && m && (m.states.has(f) || m.transitions.has(f))) return f;
    return m?.roots[0] ?? null;
  });
  const visibleStates = createMemo<string[]>(
    () => {
      const sc = scene();
      const vr = viewRect();
      const all = cullOff();
      const out: string[] = [];
      const seen = new Set<string>();
      const visit = (id: string): void => {
        if (!all && !intersects(sc.rects.get(id)!, vr)) return;
        out.push(id);
        seen.add(id);
        for (const k of sc.kids.get(id) ?? []) visit(k);
      };
      for (const r of sc.kids.get(null) ?? []) visit(r);
      const f = roving();
      if (f !== null && sc.rects.has(f) && !seen.has(f)) out.push(f);
      return out;
    },
    [],
    { equals: arrEq },
  );
  const visibleEdges = createMemo<string[]>(
    () => {
      const vr = viewRect();
      const all = cullOff();
      const s = sel();
      const f = roving();
      const out: string[] = [];
      for (const [id, e] of edges()) if (all || intersects(e.bbox, vr) || s.has(id) || f === id) out.push(id);
      return out;
    },
    [],
    { equals: arrEq },
  );
  const visibleInitials = createMemo<string[]>(
    () => {
      const vr = viewRect();
      const all = cullOff();
      const sc = scene();
      const out: string[] = [];
      for (const [k, i] of initials()) {
        const r = sc.rects.get(i.target);
        if (r && (all || intersects({ x: r.x, y: r.y - 30, w: r.w, h: r.h + 30 }, vr))) out.push(k);
      }
      return out;
    },
    [],
    { equals: arrEq },
  );

  // ---- context for the views -----------------------------------------------------------
  const diagOf = (id: string): CanvasDiagnostic | undefined => {
    const d = props.diagnostics;
    if (!d) return undefined;
    return d instanceof Map ? d.get(id) : (d as Readonly<Record<string, CanvasDiagnostic>>)[id];
  };
  const single = createMemo<string | null>(() => {
    const s = sel();
    if (s.size !== 1) return null;
    const id = [...s][0]!;
    return model()?.states.has(id) ? id : null;
  });
  const ctx: Ctx = {
    uid,
    model,
    scene,
    edges,
    initials,
    selection: sel,
    tabStop: roving,
    single,
    active: (id) => props.active?.has(id) ?? false,
    taken: (id) => props.taken?.has(id) ?? false,
    diag: diagOf,
    dropTarget: () => drag()?.drop ?? null,
    readOnly: () => props.readOnly === true,
  };

  const liveText = createMemo(() => {
    const d = props.diagnostics;
    if (!d) return "";
    const entries = d instanceof Map ? [...d.entries()] : Object.entries(d);
    if (entries.length === 0) return "";
    return `${entries.length} diagnostic${entries.length === 1 ? "" : "s"}: ` + entries.map(([id, x]) => `${x.severity} on ${id}: ${x.message}`).join("; ");
  });

  // ---- commands ------------------------------------------------------------------------
  function report(e: unknown): void {
    if (e instanceof Error) props.onError?.(e.message, e);
    else throw e;
  }
  function run(cmd: Command | readonly Command[], mergeKey?: string): boolean {
    if (props.readOnly) return false;
    try {
      props.doc.apply(cmd, mergeKey === undefined ? undefined : { mergeKey });
      return true;
    } catch (e) {
      report(e);
      return false;
    }
  }

  // ---- geometry helpers ----------------------------------------------------------------
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.getBoundingClientRect();
    const v = vp();
    return [(e.clientX - r.left - v.x) / v.zoom, (e.clientY - r.top - v.y) / v.zoom];
  };
  const viewCentre = (): Pt => {
    const v = vp();
    const s = size();
    return [(s.w / 2 - v.x) / v.zoom, (s.h / 2 - v.y) / v.zoom];
  };
  const zoomAt = (sx: number, sy: number, factor: number): void => {
    const v = vp();
    const z = clampZoom(v.zoom * factor);
    const wx = (sx - v.x) / v.zoom;
    const wy = (sy - v.y) / v.zoom;
    setViewport({ x: sx - wx * z, y: sy - wy * z, zoom: z });
  };
  const frame = (r: Rect, maxZoom: number): void => {
    const s = size();
    const margin = 40;
    const z = clampZoom(Math.min((s.w - 2 * margin) / Math.max(r.w, 1), (s.h - 2 * margin) / Math.max(r.h, 1), maxZoom));
    setViewport({ x: s.w / 2 - (r.x + r.w / 2) * z, y: s.h / 2 - (r.y + r.h / 2) * z, zoom: z });
  };
  const unionRect = (ids: Iterable<string>): Rect | null => {
    const sc = untrack(scene);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      const r = sc.rects.get(id) ?? sc.rects.get(sc.hiddenBy.get(id) ?? "");
      if (!r) continue;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const ensureVisible = (id: string): void => {
    const r = unionRect([id]);
    if (!r) return;
    if (!intersects(r, untrack(viewRect))) centerOn(id);
  };
  function centerOn(id: string): void {
    const r = unionRect([id]);
    if (!r) return;
    const v = vp();
    const s = size();
    setViewport({ x: s.w / 2 - (r.x + r.w / 2) * v.zoom, y: s.h / 2 - (r.y + r.h / 2) * v.zoom, zoom: v.zoom });
  }
  const fit = (): void => {
    const b = untrack(scene).bounds;
    if (b) frame(b, 1.5);
  };
  const zoomToSelection = (): void => {
    const states = [...untrack(sel)].filter((i) => untrack(model)?.states.has(i));
    const r = unionRect(states);
    if (r) frame(r, 2);
    else fit();
  };

  // ---- editing actions -----------------------------------------------------------------
  const kindBase = (kind: StateKind): string => (kind === "atomic" || kind === "compound" ? "state" : kind);

  // @tg: implements:: [[openspec:canvas-editing#Create states]]
  function createState(kind: StateKind, opts: { at?: { x: number; y: number }; parent?: string | null; historyType?: "shallow" | "deep" } = {}): string | null {
    const m = untrack(model);
    if (!m) return null;
    const sc = untrack(baseScene);
    const at: Pt = opts.at ? [opts.at.x, opts.at.y] : viewCentre();
    const parent = opts.parent !== undefined ? opts.parent : stateAt(m, sc, at[0], at[1], { containersOnly: true });
    const id = uniqueId(m, kindBase(kind));
    const pr = parent === null ? { x: 0, y: 0 } : sc.rects.get(parent) ?? { x: 0, y: 0 };
    const d = defaultSize(kind);
    const ok = run({
      type: "addState",
      parent,
      kind,
      id,
      ...(kind === "history" ? { historyType: opts.historyType ?? "shallow" } : {}),
      layout: { x: Math.round(at[0] - pr.x), y: Math.round(at[1] - pr.y), w: d.w, h: d.h },
    });
    if (!ok) return null;
    setSelection([id]);
    setFocusId(id);
    return id;
  }

  const toggleCollapse = (id: string): boolean => {
    const m = untrack(model);
    const st = m?.states.get(id);
    if (!m || !st || !isContainer(st.kind) || st.children.length === 0) return false;
    const l = untrack(baseScene).rel.get(id);
    if (!l) return false;
    return run({ type: "setLayout", states: { [id]: { ...l, collapsed: l.collapsed === true ? undefined : true } } });
  };

  // @tg: implements:: [[openspec:canvas-editing#Create and retarget transitions]]
  const setInitial = (id: string): boolean => {
    const m = untrack(model);
    const st = m?.states.get(id);
    if (!m || !st) return false;
    return run({ type: "setInitial", state: st.parent, initial: [id] });
  };

  // @tg: implements:: [[openspec:canvas-editing#Delete elements]]
  async function deleteSelection(): Promise<boolean> {
    const m = untrack(model);
    if (!m || props.readOnly) return false;
    let ids = [...untrack(sel)];
    if (ids.length === 0) {
      const f = untrack(focusId);
      if (f === null) return false;
      ids = [f];
    }
    const info = deleteImpact(m, ids);
    if (info.states.length === 0 && info.transitions.length === 0) return false;
    const ok = props.confirmDelete ? await props.confirmDelete(info) : true;
    if (!ok) return false;
    const cur = untrack(model);
    if (!cur) return false;
    const done = run(deleteCommands(cur, ids));
    if (done) {
      setSelection([]);
      setFocusId(null);
    }
    return done;
  }

  const writeClipboard = async (p: ClipboardPayload): Promise<void> => {
    clipboardMemory = p;
    try {
      await navigator.clipboard?.writeText(serializeClipboard(p));
    } catch {
      /* the internal copy is enough */
    }
  };
  const copy = async (): Promise<void> => {
    const m = untrack(model);
    if (!m) return;
    const p = copySelection(m, untrack(sel));
    if (p.states.length > 0) await writeClipboard(p);
  };
  const cut = async (): Promise<void> => {
    await copy();
    if (clipboardMemory && clipboardMemory.states.length > 0) await deleteSelection();
  };
  // @tg: implements:: [[openspec:canvas-editing#Selection and clipboard]]
  const paste = async (): Promise<void> => {
    let payload: ClipboardPayload | null = null;
    try {
      const text = await navigator.clipboard?.readText();
      if (text) payload = parseClipboard(text);
    } catch {
      /* fall back to the internal copy */
    }
    payload ??= clipboardMemory;
    const m = untrack(model);
    if (!payload || !m || props.readOnly) return;
    // Pasting while a container is selected pastes into it.
    const s = untrack(single);
    const target = s !== null && isContainer(m.states.get(s)!.kind) ? s : undefined;
    const res = pasteSelection(m, payload, target === undefined ? {} : { parent: target });
    if (res.commands.length > 0 && run(res.commands)) setSelection(res.roots);
  };

  function startRename(id: string): void {
    if (props.readOnly || !untrack(model)?.states.has(id)) return;
    if (props.onRenameRequest?.(id) === false) return;
    setEdit({ id });
    queueMicrotask(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  }
  const commitRename = (value: string): void => {
    const e = edit();
    setEdit(null);
    if (!e) return;
    const next = value.trim();
    if (next === "" || next === e.id) return;
    if (run({ type: "renameState", id: e.id, newId: next })) {
      setSel((s) => new Set([...s].map((i) => (i === e.id ? next : i))));
      setFocusId(next);
      props.onSelectionChange?.([...untrack(sel)]);
    }
  };

  async function relayout(scope?: string): Promise<void> {
    const m = untrack(model);
    const client = props.layoutClient;
    if (!m) return;
    if (!client) {
      report(new Error("no layout client"));
      return;
    }
    const text = props.doc.text;
    try {
      const res = await client.layout(m, { ...(scope === undefined ? {} : { scope }), keepExisting: false });
      if (props.doc.text === text) run(toSetLayoutCommand(res), "layout");
    } catch (e) {
      if (!(e instanceof LayoutCancelledError)) report(e);
    }
  }

  function exportSvg(): string {
    setCullOff(true);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    setCullOff(false);
    for (const el of Array.from(clone.querySelectorAll(".vt-overlay,[data-port],[data-resize],[data-end],[data-toggle]"))) el.remove();
    const b = untrack(scene).bounds ?? { x: 0, y: 0, w: 100, h: 100 };
    const m = 24;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${b.x - m} ${b.y - m} ${b.w + 2 * m} ${b.h + 2 * m}`);
    clone.setAttribute("width", String(Math.ceil(b.w + 2 * m)));
    clone.setAttribute("height", String(Math.ceil(b.h + 2 * m)));
    clone.setAttribute("style", themeVars(props.theme));
    clone.removeAttribute("class");
    clone.removeAttribute("tabindex");
    clone.querySelector(".vt-viewport")?.removeAttribute("transform");
    for (const el of Array.from(clone.querySelectorAll("[tabindex]"))) el.removeAttribute("tabindex");
    return clone.outerHTML;
  }

  const api: CanvasApi = {
    fit,
    zoomToSelection,
    zoomBy: (f) => zoomAt(size().w / 2, size().h / 2, f),
    centerOn,
    getViewport: () => vp(),
    exportSvg,
    relayout,
    createState,
    deleteSelection,
    copy,
    cut,
    paste,
    setInitial,
    toggleCollapse,
    rename: startRename,
  };
  props.apiRef?.(api);

  // ---- pointer interaction -------------------------------------------------------------
  const kindOf = (id: string): StateKind | undefined => untrack(model)?.states.get(id)?.kind;

  function onPointerDown(e: PointerEvent): void {
    setMenu(null);
    const t = e.target as Element;
    const w = toWorld(e);
    if (e.button === 1 || (e.button === 0 && space)) {
      gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: vp().x, vy: vp().y };
      setPanning(true);
      capture(e);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const m = untrack(model);
    if (!m) return;
    const port = t.closest("[data-port]");
    const rs = t.closest("[data-resize]");
    const end = t.closest("[data-end]");
    const tog = t.closest("[data-toggle]");
    const stEl = t.closest("[data-state-id]");
    const trEl = t.closest("[data-transition-id]");
    if (port && !props.readOnly) {
      gesture = { kind: "draw", from: port.getAttribute("data-port")!, start: w, moved: false };
      capture(e);
      e.preventDefault();
      return;
    }
    if (rs && !props.readOnly) {
      const id = rs.getAttribute("data-resize")!;
      gesture = { kind: "resize", id, start: w, key: `resize-${++dragCounter}`, moved: false };
      capture(e);
      e.preventDefault();
      return;
    }
    if (end && trEl && !props.readOnly) {
      gesture = {
        kind: "retarget",
        tid: trEl.getAttribute("data-transition-id")!,
        end: end.getAttribute("data-end") === "source" ? "source" : "target",
        index: Number(end.getAttribute("data-index") ?? 0),
        start: w,
        moved: false,
      };
      capture(e);
      e.preventDefault();
      return;
    }
    if (tog) {
      const id = (tog.closest("[data-state-id]") ?? stEl)?.getAttribute("data-state-id");
      if (id) toggleCollapse(id);
      e.preventDefault();
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (trEl && !stEl?.contains(trEl)) {
      const id = trEl.getAttribute("data-transition-id")!;
      setFocusId(id);
      if (additive) toggleSel(id);
      else setSelection([id]);
      return;
    }
    if (trEl && stEl && stEl.contains(trEl)) {
      // an internal handler badge inside its state
      const id = trEl.getAttribute("data-transition-id")!;
      setFocusId(id);
      if (additive) toggleSel(id);
      else setSelection([id]);
      return;
    }
    if (stEl) {
      const id = stEl.getAttribute("data-state-id")!;
      setFocusId(id);
      if (e.altKey && !props.readOnly) {
        gesture = { kind: "draw", from: id, start: w, moved: false };
        capture(e);
        return;
      }
      const wasSelected = untrack(sel).has(id);
      if (additive) toggleSel(id);
      else if (!wasSelected) setSelection([id]);
      if (!props.readOnly && untrack(sel).has(id)) {
        const picked = [...untrack(sel)].filter((i) => m.states.has(i));
        const top = picked.filter((i) => {
          let p = m.states.get(i)!.parent;
          while (p !== null) {
            if (picked.includes(p)) return false;
            p = m.states.get(p)!.parent;
          }
          return true;
        });
        gesture = { kind: "move", ids: top, start: w, moved: false, additive, wasSelected, key: `move-${++dragCounter}` };
        capture(e);
      }
      return;
    }
    // background: marquee
    svg.focus?.();
    gesture = { kind: "marquee", start: w, base: additive ? new Set(untrack(sel)) : new Set(), moved: false };
    capture(e);
  }

  function capture(e: PointerEvent): void {
    try {
      if (e.pointerId !== undefined) svg.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable */
    }
  }
  function toggleSel(id: string): void {
    const n = new Set(untrack(sel));
    if (!n.delete(id)) n.add(id);
    setSelection(n);
  }

  function dropTargetAt(w: Pt, exclude: ReadonlySet<string>): string | null {
    const m = untrack(model);
    return m ? stateAt(m, untrack(baseScene), w[0], w[1], { containersOnly: true, exclude }) : null;
  }

  function onPointerMove(e: PointerEvent): void {
    const g = gesture;
    if (!g) return;
    const z = vp().zoom;
    if (g.kind === "pan") {
      setViewport({ x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy), zoom: z });
      return;
    }
    const w = toWorld(e);
    const dx = w[0] - g.start[0];
    const dy = w[1] - g.start[1];
    if (!g.moved && Math.hypot(dx * z, dy * z) < 4) return;
    g.moved = true;
    const sc = untrack(baseScene);
    if (g.kind === "move") {
      const override = new Map<string, StateLayout>();
      for (const id of g.ids) {
        const r = sc.rel.get(id);
        if (r) override.set(id, { ...r, x: r.x + dx, y: r.y + dy });
      }
      setDrag({ override, drop: dropTargetAt(w, new Set(g.ids)) });
    } else if (g.kind === "resize") {
      const r = sc.rel.get(g.id);
      if (r) setDrag({ override: new Map([[g.id, { ...r, w: Math.max(40, r.w + dx), h: Math.max(30, r.h + dy) }]]), drop: null });
    } else if (g.kind === "draw") {
      setDraft({ from: g.from, to: w });
    } else if (g.kind === "retarget") {
      const t = untrack(model)?.transitions.get(g.tid);
      if (t) setDraft({ from: g.end === "source" ? (t.targets[g.index] ?? t.source) : t.source, to: w });
    } else {
      const r: Rect = { x: Math.min(g.start[0], w[0]), y: Math.min(g.start[1], w[1]), w: Math.abs(dx), h: Math.abs(dy) };
      setMarquee(r);
      const next = new Set(g.base);
      for (const id of sc.order) {
        const sr = sc.rects.get(id)!;
        if (sr.x >= r.x && sr.y >= r.y && sr.x + sr.w <= r.x + r.w && sr.y + sr.h <= r.y + r.h) next.add(id);
      }
      setSelection(next);
    }
  }

  // @tg: implements:: [[openspec:canvas-editing#Reparent states]]
  // @tg: implements:: [[openspec:canvas-editing#Create and retarget transitions]]
  function onPointerUp(e: PointerEvent): void {
    const g = gesture;
    gesture = null;
    setPanning(false);
    const d = untrack(drag);
    batch(() => {
      setDrag(null);
      setDraft(null);
      setMarquee(null);
    });
    if (!g || g.kind === "pan") return;
    const m = untrack(model);
    if (!m) return;
    const w = toWorld(e);
    const sc = untrack(baseScene);
    if (g.kind === "move") {
      if (!g.moved) {
        if (!g.additive && g.wasSelected && untrack(sel).size > 1) setSelection([g.ids[0]!]);
        return;
      }
      const dx = w[0] - g.start[0];
      const dy = w[1] - g.start[1];
      const target = dropTargetAt(w, new Set(g.ids));
      const cmds: Command[] = [];
      const states: Record<string, StateLayout> = {};
      for (const id of g.ids) {
        const st = m.states.get(id);
        const old = sc.rects.get(id);
        const r = sc.rel.get(id);
        if (!st || !old || !r) continue;
        if (target !== st.parent) cmds.push({ type: "reparentState", id, parent: target });
        const pr = target === null ? { x: 0, y: 0 } : sc.rects.get(target) ?? { x: 0, y: 0 };
        states[id] = { ...r, x: Math.round(old.x + dx - pr.x), y: Math.round(old.y + dy - pr.y) };
      }
      cmds.push({ type: "setLayout", states });
      run(cmds, g.key);
    } else if (g.kind === "resize") {
      const o = d?.override.get(g.id);
      if (g.moved && o) run({ type: "setLayout", states: { [g.id]: { ...o, w: Math.round(o.w), h: Math.round(o.h) } } }, g.key);
    } else if (g.kind === "draw") {
      if (!g.moved) return;
      const target = stateAt(m, sc, w[0], w[1]);
      if (target === null) return;
      if (run({ type: "addTransition", source: g.from, targets: [target], events: [] })) {
        const list = untrack(model)?.states.get(g.from)?.transitions ?? [];
        const tid = list[list.length - 1];
        if (tid !== undefined) {
          setSelection([tid]);
          setFocusId(tid);
          props.onRequestTransitionDetails?.(tid);
        }
      }
    } else if (g.kind === "retarget") {
      if (!g.moved) return;
      const t = m.transitions.get(g.tid);
      const target = stateAt(m, sc, w[0], w[1]);
      if (!t || target === null) return;
      if (g.end === "source") {
        if (target !== t.source && run({ type: "updateTransition", id: g.tid, source: target })) setSelection([]);
      } else {
        const targets = [...t.targets];
        targets[g.index] = target;
        run({ type: "updateTransition", id: g.tid, targets });
      }
    } else if (!g.moved && g.base.size === 0) setSelection([]);
  }

  function onDblClick(e: MouseEvent): void {
    const t = e.target as Element;
    const stEl = t.closest("[data-state-id]");
    const m = untrack(model);
    if (!m || t.closest("[data-toggle],[data-port],[data-resize],[data-end]")) return;
    if (t.closest("[data-transition-id]")) return;
    const w = toWorld(e);
    if (stEl) {
      const id = stEl.getAttribute("data-state-id")!;
      const st = m.states.get(id)!;
      const r = untrack(scene).rects.get(id)!;
      if (!isContainer(st.kind) || w[1] < r.y + HEADER || untrack(scene).collapsed.has(id)) {
        startRename(id);
        return;
      }
    }
    if (props.readOnly) return;
    createState("atomic", { at: { x: w[0], y: w[1] } });
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const t = e.target as Element;
    const state = t.closest("[data-state-id]")?.getAttribute("data-state-id") ?? undefined;
    const transition = t.closest("[data-transition-id]")?.getAttribute("data-transition-id") ?? undefined;
    const w = toWorld(e);
    if (props.onContextMenu) {
      props.onContextMenu({ clientX: e.clientX, clientY: e.clientY, world: { x: w[0], y: w[1] }, ...(state ? { state } : {}), ...(transition ? { transition } : {}) });
      return;
    }
    const r = svg.getBoundingClientRect();
    setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, world: w, ...(state ? { state } : {}), ...(transition ? { transition } : {}) });
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const v = vp();
    if (e.ctrlKey || e.metaKey) {
      const r = svg.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    } else setViewport({ x: v.x - e.deltaX, y: v.y - e.deltaY, zoom: v.zoom });
  }

  // ---- keyboard ------------------------------------------------------------------------
  const siblingsOf = (id: string): readonly string[] => {
    const m = untrack(model);
    const sc = untrack(scene);
    if (!m) return [];
    const st = m.states.get(id);
    if (!st) return [];
    const list = st.parent === null ? m.roots : m.states.get(st.parent)!.children;
    return list.filter((i) => sc.rects.has(i));
  };
  const focusOn = (id: string): void => {
    setFocusId(id);
    ensureVisible(id);
  };
  function navigate(key: string): boolean {
    const m = untrack(model);
    const f = untrack(roving);
    if (!m || f === null) return false;
    const tr = m.transitions.get(f);
    if (tr) {
      const sibs = m.states.get(tr.source)!.transitions;
      const i = sibs.indexOf(f);
      if (key === "ArrowDown" || key === "ArrowRight") focusOn(sibs[Math.min(sibs.length - 1, i + 1)]!);
      else if (key === "ArrowUp") focusOn(sibs[Math.max(0, i - 1)]!);
      else if (key === "ArrowLeft") focusOn(tr.source);
      else return false;
      return true;
    }
    const st = m.states.get(f);
    if (!st) return false;
    const sibs = siblingsOf(f);
    const i = sibs.indexOf(f);
    switch (key) {
      case "ArrowDown":
        if (sibs[i + 1] !== undefined) focusOn(sibs[i + 1]!);
        return true;
      case "ArrowUp":
        if (sibs[i - 1] !== undefined) focusOn(sibs[i - 1]!);
        return true;
      case "ArrowLeft":
        if (st.parent !== null) focusOn(st.parent);
        return true;
      case "ArrowRight":
      case "Enter": {
        const first = st.children.find((c) => untrack(scene).rects.has(c));
        if (first !== undefined && !untrack(scene).collapsed.has(f)) focusOn(first);
        else if (key === "Enter") setSelection([f]);
        return true;
      }
      case "Home":
        if (sibs[0] !== undefined) focusOn(sibs[0]);
        return true;
      case "End":
        if (sibs.length > 0) focusOn(sibs[sibs.length - 1]!);
        return true;
      default:
        return false;
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (edit()) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === " ") {
      space = true;
      e.preventDefault();
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      void deleteSelection();
    } else if (key === "Escape") {
      gesture = null;
      batch(() => {
        setDrag(null);
        setDraft(null);
        setMarquee(null);
        setPanning(false);
        setMenu(null);
      });
      setSelection([]);
    } else if (key === "F2") {
      e.preventDefault();
      const f = untrack(roving);
      const target = untrack(single) ?? (f !== null && kindOf(f) ? f : null);
      if (target) startRename(target);
    } else if (mod && key === "Enter") {
      const f = untrack(roving);
      if (f !== null) props.onRevealRequest?.(f);
    } else if (mod && (key === "c" || key === "C")) {
      e.preventDefault();
      void copy();
    } else if (mod && (key === "x" || key === "X")) {
      e.preventDefault();
      void cut();
    } else if (mod && (key === "v" || key === "V")) {
      e.preventDefault();
      void paste();
    } else if (mod && (key === "a" || key === "A")) {
      e.preventDefault();
      const sc = untrack(scene);
      setSelection(sc.order);
    } else if (key === "+" || key === "=") zoomAt(size().w / 2, size().h / 2, 1.25);
    else if (key === "-") zoomAt(size().w / 2, size().h / 2, 0.8);
    else if (key === "0") fit();
    else if (key === "c" && !mod) {
      const f = untrack(roving);
      if (f !== null) toggleCollapse(f);
    } else if (key === "i" && !mod) {
      const f = untrack(roving);
      if (f !== null && kindOf(f)) setInitial(f);
    } else if (key === "t" && !mod) {
      const f = untrack(roving);
      const first = f === null ? undefined : untrack(model)?.states.get(f)?.transitions[0];
      if (first !== undefined) focusOn(first);
    } else if (navigate(key)) e.preventDefault();
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === " ") space = false;
  }

  // Move DOM focus with the roving tab stop (keyboard navigation announces through aria-label).
  createEffect(
    on(focusId, (id) => {
      if (id === null || !svg) return;
      const el = Array.from(svg.querySelectorAll("[data-state-id],[data-transition-id]")).find(
        (n) => n.getAttribute("data-state-id") === id || n.getAttribute("data-transition-id") === id,
      );
      (el as unknown as { focus?: (o?: object) => void } | undefined)?.focus?.({ preventScroll: true });
    }),
  );

  onMount(() => {
    const measure = (): void => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      if (w > 0 && h > 0) setSize({ w, h });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    ro?.observe(root);
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("dblclick", onDblClick);
    svg.addEventListener("contextmenu", onContextMenu);
    svg.addEventListener("keydown", onKeyDown);
    svg.addEventListener("keyup", onKeyUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      ro?.disconnect();
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.removeEventListener("dblclick", onDblClick);
      svg.removeEventListener("contextmenu", onContextMenu);
      svg.removeEventListener("keydown", onKeyDown);
      svg.removeEventListener("keyup", onKeyUp);
      svg.removeEventListener("wheel", onWheel);
    });
  });

  // ---- view ----------------------------------------------------------------------------
  const draftPath = createMemo(() => {
    const dr = draft();
    if (!dr) return "";
    const r = scene().rects.get(dr.from);
    if (!r) return "";
    return smoothPath([borderToward(r, dr.to), dr.to]);
  });
  const editBox = createMemo(() => {
    const e = edit();
    if (!e) return null;
    const r = scene().rects.get(e.id);
    if (!r) return null;
    const v = vp();
    const container = isContainer(kindOf(e.id) ?? "atomic");
    return { left: r.x * v.zoom + v.x + 6, top: (r.y + (container ? 4 : r.h / 2 - 12)) * v.zoom + v.y, width: Math.max(80, (r.w - 12) * v.zoom) };
  });

  const menuItems = (m: MenuState): { label: string; run: () => void }[] => {
    const items: { label: string; run: () => void }[] = [];
    const model0 = untrack(model);
    const at = { x: m.world[0], y: m.world[1] };
    if (m.state && model0?.states.has(m.state)) {
      const id = m.state;
      const st = model0.states.get(id)!;
      if (!props.readOnly) {
        items.push({ label: "Rename", run: () => startRename(id) });
        items.push({ label: "Set as initial", run: () => void setInitial(id) });
        if (isContainer(st.kind)) {
          items.push({ label: st.kind === "compound" || st.kind === "parallel" ? (untrack(scene).collapsed.has(id) ? "Expand" : "Collapse") : "", run: () => void toggleCollapse(id) });
          for (const k of ["atomic", "compound", "parallel", "final"] as const) items.push({ label: `New ${k} state inside`, run: () => void createState(k, { at, parent: id }) });
        }
        items.push({ label: "Delete", run: () => void (setSelection([id]), deleteSelection()) });
      }
      if (props.onRevealRequest) items.push({ label: "Reveal in text", run: () => props.onRevealRequest?.(id) });
    } else if (m.transition) {
      const id = m.transition;
      if (!props.readOnly) items.push({ label: "Delete transition", run: () => void (setSelection([id]), deleteSelection()) });
      if (props.onRevealRequest) items.push({ label: "Reveal in text", run: () => props.onRevealRequest?.(id) });
    } else if (!props.readOnly) {
      for (const k of ["atomic", "compound", "parallel", "final"] as const) items.push({ label: `New ${k} state`, run: () => void createState(k, { at }) });
      items.push({ label: "New history state", run: () => void createState("history", { at, historyType: "shallow" }) });
      items.push({ label: "New deep history state", run: () => void createState("history", { at, historyType: "deep" }) });
    }
    return items;
  };

  const tool = (label: string, title: string, fn: () => void): JSX.Element => (
    <button type="button" aria-label={title} title={title} onClick={fn}>
      {label}
    </button>
  );

  return (
    <div class="vt-root" ref={root} data-theme={props.theme.kind} style={themeVars(props.theme)}>
      <style>{CANVAS_CSS}</style>
      <svg
        ref={svg}
        class={panning() ? "vt-svg vt-panning" : "vt-svg"}
        role="application"
        aria-label="Statechart canvas"
        aria-roledescription="statechart canvas"
        tabindex={-1}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <For each={["n", "sel", "act", "err", "ini"]}>
            {(v) => (
              <marker id={`${uid}-${v}`} class={`vt-marker-${v}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={8} markerHeight={8} orient="auto">
                <path d="M0 1L10 5L0 9z" />
              </marker>
            )}
          </For>
        </defs>
        <g class="vt-viewport" transform={`translate(${vp().x} ${vp().y}) scale(${vp().zoom})`}>
          <g class="vt-states">
            <For each={visibleStates()}>{(id) => <StateView id={id} c={ctx} />}</For>
          </g>
          <g class="vt-initials">
            <For each={visibleInitials()}>{(k) => <InitialView id={k} c={ctx} />}</For>
          </g>
          <g class="vt-edges">
            <For each={visibleEdges()}>{(id) => <EdgeView id={id} c={ctx} />}</For>
          </g>
          <g class="vt-overlay">
            <Show when={draft()}>
              <path class="vt-draft" d={draftPath()} data-draft="true" />
            </Show>
            <Show when={marquee()}>{(r) => <rect class="vt-marquee" x={r().x} y={r().y} width={r().w} height={r().h} />}</Show>
          </g>
        </g>
      </svg>
      <Show when={props.toolbar !== false && !props.readOnly}>
        <div class="vt-toolbar" role="toolbar" aria-label="Canvas tools">
          {tool("▭", "New atomic state", () => createState("atomic"))}
          {tool("▣", "New compound state", () => createState("compound"))}
          {tool("‖", "New parallel state", () => createState("parallel"))}
          {tool("◉", "New final state", () => createState("final"))}
          {tool("H", "New shallow history state", () => createState("history", { historyType: "shallow" }))}
          {tool("H*", "New deep history state", () => createState("history", { historyType: "deep" }))}
          {tool("+", "Zoom in", () => api.zoomBy(1.25))}
          {tool("−", "Zoom out", () => api.zoomBy(0.8))}
          {tool("Fit", "Zoom to fit", fit)}
        </div>
      </Show>
      <Show when={menu()}>
        {(m) => (
          <div class="vt-menu" role="menu" style={{ left: `${m().x}px`, top: `${m().y}px` }}>
            <For each={menuItems(m()).filter((i) => i.label !== "")}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    item.run();
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={editBox()}>
        {(b) => (
          <input
            ref={renameInput}
            class="vt-rename"
            aria-label="State id"
            value={edit()?.id ?? ""}
            style={{ left: `${b().left}px`, top: `${b().top}px`, width: `${b().width}px` }}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === "Enter") commitRename(ev.currentTarget.value);
              else if (ev.key === "Escape") setEdit(null);
            }}
            onBlur={(ev) => commitRename(ev.currentTarget.value)}
          />
        )}
      </Show>
      <div class="vt-live" aria-live="polite" role="status">
        {liveText()}
      </div>
    </div>
  );
}
