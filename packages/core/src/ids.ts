import { EditError, type ChartModel } from "./model.js";

/** State and data ids: an ASCII NCName subset that is valid in SCXML and plain in YAML. */
const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function checkNewId(model: ChartModel, id: string): void {
  if (!isValidId(id)) throw new EditError("InvalidId", `\`${id}\` is not a valid id`);
  if (model.states.has(id) || model.data.some((d) => d.id === id)) {
    throw new EditError("DuplicateId", `the id \`${id}\` is already used`);
  }
}

export function requireState(model: ChartModel, id: string): void {
  if (!model.states.has(id)) throw new EditError("UnknownId", `no state \`${id}\``);
}

/** `base` if unused by any state or data item, else `base_1`, `base_2`, ... */
export function uniqueId(model: ChartModel, base: string): string {
  const taken = (id: string) => model.states.has(id) || model.data.some((d) => d.id === id);
  if (!taken(base)) return base;
  for (let n = 1; ; n++) {
    const id = `${base}_${n}`;
    if (!taken(id)) return id;
  }
}

/** Ids of `id` and all its descendants. */
export function subtree(model: ChartModel, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (s: string) => {
    out.add(s);
    for (const c of model.states.get(s)?.children ?? []) walk(c);
  };
  walk(id);
  return out;
}

/** Default id base for a new state of a kind. */
export function idBase(kind: string): string {
  return kind === "atomic" || kind === "compound" ? "state" : kind;
}

/** Initial targets must exist and be proper descendants of a compound `state` (or any state at the root). */
export function checkInitial(model: ChartModel, state: string | null, initial: readonly string[]): void {
  for (const t of initial) requireState(model, t);
  if (state === null || initial.length === 0) return;
  requireState(model, state);
  const st = model.states.get(state)!;
  if (st.kind !== "compound") throw new EditError("Unsupported", `\`${state}\` is not a compound state`);
  const inside = subtree(model, state);
  for (const t of initial) {
    if (t === state || !inside.has(t)) throw new EditError("Unsupported", `\`${t}\` is not inside \`${state}\``);
  }
}

/** A chart keeps at least one top-level state. */
export function checkRemovable(model: ChartModel, id: string): void {
  requireState(model, id);
  if (model.roots.length === 1 && model.roots[0] === id) throw new EditError("Unsupported", "a chart needs at least one state");
}

/** Data items live at the top level or in states that may have a datamodel. */
export function checkDataOwner(model: ChartModel, owner: string | null): void {
  if (owner === null) return;
  requireState(model, owner);
  const k = model.states.get(owner)!.kind;
  if (k === "final" || k === "history") throw new EditError("Unsupported", `a ${k} state has no datamodel`);
}
