/**
 * Copy, cut and paste of states with their internal transitions, as pure functions from a
 * model to core commands. The clipboard payload is a small JSON document.
 */
import type { ChartModel, Command, ContentItem, StateKind, StateLayout } from "@vertepnyk/core";

export interface ClipboardState {
  readonly id: string;
  readonly kind: StateKind;
  readonly historyType?: "shallow" | "deep";
  /** The parent within the payload; null for a copied root. */
  readonly parent: string | null;
  /** Layout relative to the (original) parent. */
  readonly layout?: StateLayout;
  readonly initial: readonly string[];
  readonly onentry: readonly ContentItem[];
  readonly onexit: readonly ContentItem[];
}

export interface ClipboardTransition {
  readonly source: string;
  readonly targets: readonly string[];
  readonly events: readonly string[];
  readonly cond?: string;
  readonly type: "external" | "internal";
  readonly actions: readonly ContentItem[];
}

export interface ClipboardPayload {
  readonly vertepnyk: "clipboard";
  readonly version: 1;
  /** The parent the first root was copied from. */
  readonly rootParent: string | null;
  readonly states: readonly ClipboardState[];
  readonly transitions: readonly ClipboardTransition[];
}

/** Copies the selected states (ids of other kinds are ignored) with their descendants and internal transitions. */
// @tg: implements:: [[openspec:canvas-editing#Selection and clipboard]]
export function copySelection(model: ChartModel, ids: Iterable<string>): ClipboardPayload {
  const picked = new Set<string>();
  for (const id of ids) if (model.states.has(id)) picked.add(id);
  const roots: string[] = [];
  for (const id of picked) {
    let p = model.states.get(id)!.parent;
    let covered = false;
    while (p !== null) {
      if (picked.has(p)) {
        covered = true;
        break;
      }
      p = model.states.get(p)!.parent;
    }
    if (!covered) roots.push(id);
  }
  // Document order of the roots keeps pasted siblings in order.
  const orderIdx = new Map<string, number>();
  let n = 0;
  const walk = (id: string): void => {
    orderIdx.set(id, n++);
    for (const c of model.states.get(id)!.children) walk(c);
  };
  for (const r of model.roots) walk(r);
  roots.sort((a, b) => orderIdx.get(a)! - orderIdx.get(b)!);

  const states: ClipboardState[] = [];
  const inPayload = new Set<string>();
  const emit = (id: string, parent: string | null): void => {
    const st = model.states.get(id)!;
    inPayload.add(id);
    const layout = model.layout.get(id);
    states.push({
      id,
      kind: st.kind,
      ...(st.historyType ? { historyType: st.historyType } : {}),
      parent,
      ...(layout ? { layout } : {}),
      initial: st.initial,
      onentry: st.onentry.flatMap((b) => [...b.items]),
      onexit: st.onexit.flatMap((b) => [...b.items]),
    });
    for (const c of st.children) emit(c, id);
  };
  for (const r of roots) emit(r, null);

  const transitions: ClipboardTransition[] = [];
  for (const id of inPayload) {
    for (const tid of model.states.get(id)!.transitions) {
      const t = model.transitions.get(tid)!;
      if (!t.targets.every((x) => inPayload.has(x))) continue;
      transitions.push({
        source: t.source,
        targets: t.targets,
        events: t.events,
        ...(t.cond !== undefined ? { cond: t.cond } : {}),
        type: t.type,
        actions: t.actions,
      });
    }
  }
  const first = roots[0];
  return {
    vertepnyk: "clipboard",
    version: 1,
    rootParent: first === undefined ? null : model.states.get(first)!.parent,
    states,
    transitions,
  };
}

export function serializeClipboard(p: ClipboardPayload): string {
  return JSON.stringify(p);
}

export function parseClipboard(text: string): ClipboardPayload | null {
  try {
    const v = JSON.parse(text) as Partial<ClipboardPayload>;
    if (v && v.vertepnyk === "clipboard" && v.version === 1 && Array.isArray(v.states) && Array.isArray(v.transitions)) {
      return v as ClipboardPayload;
    }
  } catch {
    /* not ours */
  }
  return null;
}

export interface PasteResult {
  readonly commands: Command[];
  /** Original id -> id in the chart after the paste. */
  readonly idMap: ReadonlyMap<string, string>;
  /** The new ids of the pasted roots. */
  readonly roots: readonly string[];
}

/**
 * Commands that paste `payload` into `model`: under `opts.parent` (default: where the states
 * were copied from, if it still is a container), offset by `opts.offset`. Ids that are taken
 * get a numeric suffix; ids that are free (after a cut) are kept.
 */
// @tg: implements:: [[openspec:canvas-editing#Selection and clipboard]]
export function pasteSelection(
  model: ChartModel,
  payload: ClipboardPayload,
  opts: { parent?: string | null; offset?: { x: number; y: number } } = {},
): PasteResult {
  const off = opts.offset ?? { x: 24, y: 24 };
  let parent = opts.parent === undefined ? payload.rootParent : opts.parent;
  if (parent !== null) {
    const p = model.states.get(parent);
    if (!p || (p.kind !== "compound" && p.kind !== "parallel")) parent = null;
  }
  const taken = new Set<string>([...model.states.keys(), ...model.data.map((d) => d.id)]);
  const idMap = new Map<string, string>();
  for (const s of payload.states) {
    let id = s.id;
    for (let k = 1; taken.has(id); k++) id = `${s.id}_${k}`;
    taken.add(id);
    idMap.set(s.id, id);
  }
  const commands: Command[] = [];
  const roots: string[] = [];
  for (const s of payload.states) {
    const id = idMap.get(s.id)!;
    const isRoot = s.parent === null;
    if (isRoot) roots.push(id);
    const layout = s.layout ? (isRoot ? { ...s.layout, x: s.layout.x + off.x, y: s.layout.y + off.y } : s.layout) : undefined;
    commands.push({
      type: "addState",
      parent: isRoot ? parent : idMap.get(s.parent!)!,
      kind: s.kind,
      id,
      ...(s.historyType ? { historyType: s.historyType } : {}),
      ...(layout ? { layout } : {}),
    });
  }
  const inside = new Set(payload.states.map((s) => s.id));
  for (const s of payload.states) {
    const id = idMap.get(s.id)!;
    if (s.initial.length > 0 && s.initial.every((i) => inside.has(i))) {
      commands.push({ type: "setInitial", state: id, initial: s.initial.map((i) => idMap.get(i)!) });
    }
    if (s.onentry.length > 0) commands.push({ type: "setContent", owner: { state: id, slot: "onentry" }, items: s.onentry });
    if (s.onexit.length > 0) commands.push({ type: "setContent", owner: { state: id, slot: "onexit" }, items: s.onexit });
  }
  const perSource = new Map<string, number>();
  for (const t of payload.transitions) {
    if (!inside.has(t.source) || !t.targets.every((x) => inside.has(x))) continue;
    const source = idMap.get(t.source)!;
    const k = perSource.get(source) ?? 0;
    perSource.set(source, k + 1);
    commands.push({
      type: "addTransition",
      source,
      targets: t.targets.map((x) => idMap.get(x)!),
      events: t.events,
      ...(t.cond !== undefined ? { cond: t.cond } : {}),
      ...(t.type === "internal" ? { transitionType: "internal" as const } : {}),
    });
    if (t.actions.length > 0) commands.push({ type: "setContent", owner: { transition: `${source}#${k}` }, items: t.actions });
  }
  return { commands, idMap, roots };
}

export interface DeleteInfo {
  /** Every state that will be removed, descendants included. */
  readonly states: readonly string[];
  /** Every transition that will be removed: selected, owned by or targeting a removed state. */
  readonly transitions: readonly string[];
}

/** What deleting `ids` (states and transitions) removes. */
// @tg: implements:: [[openspec:canvas-editing#Delete elements]]
export function deleteImpact(model: ChartModel, ids: Iterable<string>): DeleteInfo {
  const gone = new Set<string>();
  const walk = (id: string): void => {
    gone.add(id);
    for (const c of model.states.get(id)!.children) walk(c);
  };
  const selTransitions = new Set<string>();
  for (const id of ids) {
    if (model.states.has(id)) walk(id);
    else if (model.transitions.has(id)) selTransitions.add(id);
  }
  const transitions: string[] = [];
  for (const t of model.transitions.values()) {
    if (selTransitions.has(t.id) || gone.has(t.source) || t.targets.some((x) => gone.has(x))) transitions.push(t.id);
  }
  return { states: [...gone], transitions };
}

/** Commands that delete `ids`: selected transitions first (highest index first), then top-most states. */
export function deleteCommands(model: ChartModel, ids: Iterable<string>): Command[] {
  const set = new Set(ids);
  const cmds: Command[] = [];
  const doomed = new Set<string>();
  const walk = (id: string): void => {
    doomed.add(id);
    for (const c of model.states.get(id)!.children) walk(c);
  };
  for (const id of set) if (model.states.has(id)) walk(id);
  const trs = [...set]
    .map((id) => model.transitions.get(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined && !doomed.has(t.source) && !t.targets.some((x) => doomed.has(x)))
    .sort((a, b) => (a.source === b.source ? b.index - a.index : 0));
  for (const t of trs) cmds.push({ type: "removeTransition", id: t.id });
  for (const id of set) {
    const st = model.states.get(id);
    if (!st) continue;
    let p = st.parent;
    let covered = false;
    while (p !== null) {
      if (set.has(p)) covered = true;
      p = model.states.get(p)!.parent;
    }
    if (!covered) cmds.push({ type: "removeState", id });
  }
  return cmds;
}
