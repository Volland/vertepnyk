/**
 * Edit commands on vertep YAML text: each command becomes minimal patches located through the
 * `yaml` document's source ranges. Comments, quoting and styles outside the edited nodes stay
 * byte-identical; inserted entries follow the indentation of their siblings.
 */
import { isMap, isScalar, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import {
  EditError,
  type Command,
  type ContentItem,
  type ContentOwner,
  type StateLayout,
  type TextPatch,
  type TransitionLayout,
} from "../model.js";
import type { Backend, EditSession, Mark } from "../backend.js";
import { commonEnds, sameItem } from "../content.js";
import { checkDataOwner, checkInitial, checkNewId, checkRemovable, idBase, requireState, subtree, uniqueId } from "../ids.js";
import { columnOf, firstOnLine, lineStart, mapOffset, reindent } from "../text.js";
import { asMap, asSeq, colonEnd, contentEnd, dashOf, eol, getPair, isEmptyNull, isNull, keyStr, pairEnd, start, str, type YPair } from "./cst.js";
import { N, NULL, S, afterKey, contentYV, flow, flowable, item as itemText, q, targetsYV, type YV } from "./emit.js";
import { parseVtYaml, type YamlParsed, type YState, type YTrans } from "./semantic.js";

type Session = EditSession<YamlParsed>;

// ------------------------------------------------------------------------------ primitives

function detectUnit(p: YamlParsed): string {
  const t = p.text;
  for (const ys of p.states.values()) {
    const m = ys.map;
    if (!m || m.flow || m.items.length === 0) continue;
    const d = columnOf(t, start((m.items[0] as YPair).key)) - columnOf(t, start(ys.pair.key));
    if (d > 0) return " ".repeat(d);
  }
  return "  ";
}

function indentOf(t: string, offset: number): string {
  return " ".repeat(columnOf(t, offset));
}

/** Lines `[lineStart(a), eol(b) + 1)`, the whole lines from `a` to `b`. */
function wholeLines(t: string, a: number, b: number): TextPatch {
  const e = eol(t, b);
  return { start: lineStart(t, a), end: e < t.length ? e + 1 : e, text: "" };
}

/** Replace the value of an existing pair. `inFlow` when the pair is in a flow mapping. */
function replaceValue(s: Session, pair: YPair, v: YV, inFlow: boolean): TextPatch {
  const t = s.text;
  const unit = detectUnit(s.parsed);
  const ind = indentOf(t, start(pair.key));
  const old = pair.value;
  const c = colonEnd(t, pair);
  if (isEmptyNull(old)) return { start: c, end: c, text: inFlow ? " " + flow(v) : afterKey(v, ind, unit) };
  const oldBlock = (isMap(old) || isSeq(old)) && !(old as YAMLMap).flow;
  if (inFlow) return { start: start(old), end: contentEnd(t, old), text: flow(v) };
  if (!oldBlock && flowable(v)) return { start: start(old), end: contentEnd(t, old), text: flow(v) };
  return { start: c, end: contentEnd(t, old), text: afterKey(v, ind, unit) };
}

/** Set `key` in a mapping with items (replacing its value, or adding the entry). */
function setInMap(s: Session, map: YAMLMap, key: string, v: YV, beforeKey?: string): TextPatch {
  const t = s.text;
  const pair = getPair(map, key);
  if (pair) return replaceValue(s, pair, v, !!map.flow);
  const items = map.items as YPair[];
  if (map.flow) {
    if (items.length === 0) return { start: start(map), end: map.range![1], text: `{ ${q(key)}: ${flow(v)} }` };
    const at = pairEnd(t, items[items.length - 1]!);
    return { start: at, end: at, text: `, ${q(key)}: ${flow(v)}` };
  }
  const unit = detectUnit(s.parsed);
  const ind = indentOf(t, start(items[0]!.key));
  const before = beforeKey ? getPair(map, beforeKey) : undefined;
  if (before && firstOnLine(t, start(before.key))) {
    const at = lineStart(t, start(before.key));
    return { start: at, end: at, text: `${ind}${q(key)}:${afterKey(v, ind, unit)}\n` };
  }
  const at = eol(t, pairEnd(t, items[items.length - 1]!));
  return { start: at, end: at, text: `\n${ind}${q(key)}:${afterKey(v, ind, unit)}` };
}

/** Set `key` in the mapping held by `holder` (a state entry), creating the mapping if empty. */
function setInHolder(s: Session, holder: YPair, parentFlow: boolean, key: string, v: YV): TextPatch {
  const t = s.text;
  const m = asMap(holder.value);
  if (m && m.items.length > 0) return setInMap(s, m, key, v);
  if (!m && !isNull(holder.value)) throw new EditError("Unsupported", `\`${keyStr(holder)}\` is not a mapping`);
  if (parentFlow) return replaceValue(s, holder, { map: [[key, v]], flow: true }, true);
  const unit = detectUnit(s.parsed);
  const ind = indentOf(t, start(holder.key)) + unit;
  const c = colonEnd(t, holder);
  const end = isEmptyNull(holder.value) ? c : contentEnd(t, holder.value);
  return { start: c, end, text: `\n${ind}${q(key)}:${afterKey(v, ind, unit)}` };
}

/** Remove one entry of a mapping. A block mapping keeps at least `{}`. */
function removeFromMap(s: Session, map: YAMLMap, pair: YPair): TextPatch {
  const t = s.text;
  const items = map.items as YPair[];
  const i = items.indexOf(pair);
  if (map.flow) {
    if (items.length === 1) return { start: start(map), end: map.range![1], text: "{}" };
    if (i < items.length - 1) return { start: start(pair.key), end: start(items[i + 1]!.key), text: "" };
    return { start: pairEnd(t, items[i - 1]!), end: pairEnd(t, pair), text: "" };
  }
  if (firstOnLine(t, start(pair.key))) {
    if (items.length === 1) return { start: start(pair.key), end: pairEnd(t, pair), text: "{}" };
    return wholeLines(t, start(pair.key), pairEnd(t, pair));
  }
  // The first entry of a block mapping that is a sequence item (`- key: value`).
  if (items.length > 1) return { start: start(pair.key), end: start(items[1]!.key), text: "" };
  return { start: start(pair.key), end: pairEnd(t, pair), text: "{}" };
}

/** Remove an entry of a state's mapping; the last entry leaves `{}`. */
function removeFromState(s: Session, ys: YState, pair: YPair): TextPatch {
  const t = s.text;
  const m = ys.map!;
  if (m.items.length === 1 && !m.flow) return { start: colonEnd(t, ys.pair), end: contentEnd(t, m), text: " {}" };
  return removeFromMap(s, m, pair);
}

function appendToSeq(s: Session, seq: YAMLSeq, v: YV): TextPatch {
  const t = s.text;
  const items = seq.items;
  if (seq.flow) {
    if (items.length === 0) return { start: start(seq), end: seq.range![1], text: `[${flow(v)}]` };
    const at = contentEnd(t, items[items.length - 1]);
    return { start: at, end: at, text: `, ${flow(v)}` };
  }
  const unit = detectUnit(s.parsed);
  const ind = indentOf(t, dashOf(t, items[0]));
  const at = eol(t, contentEnd(t, items[items.length - 1]));
  return { start: at, end: at, text: `\n${ind}- ${itemText(v, ind + "  ", unit)}` };
}

function removeFromSeq(s: Session, seq: YAMLSeq, node: unknown): TextPatch {
  const t = s.text;
  const items = seq.items;
  const i = items.indexOf(node);
  if (seq.flow) {
    if (items.length === 1) return { start: start(seq), end: seq.range![1], text: "[]" };
    if (i < items.length - 1) return { start: start(node), end: start(items[i + 1]), text: "" };
    return { start: contentEnd(t, items[i - 1]), end: contentEnd(t, node), text: "" };
  }
  const d = dashOf(t, node);
  if (firstOnLine(t, d)) return wholeLines(t, d, contentEnd(t, node));
  return { start: d, end: contentEnd(t, node), text: "" };
}

/** Replace a node's text (a scalar, flow collection or an item). */
function replaceNode(s: Session, node: unknown, v: YV): TextPatch {
  const t = s.text;
  const unit = detectUnit(s.parsed);
  return { start: start(node), end: contentEnd(t, node), text: itemText(v, indentOf(t, start(node)), unit) };
}

function renameKey(pair: YPair, newKey: string): TextPatch {
  const k = pair.key as { range: [number, number, number] };
  return { start: k.range[0], end: k.range[1], text: q(newKey) };
}

// ------------------------------------------------------------------------------ lookups

function yState(p: YamlParsed, id: string): YState {
  const ys = p.states.get(id);
  if (!ys) throw new EditError("UnknownId", `no state \`${id}\``);
  return ys;
}

function yTrans(p: YamlParsed, id: string): YTrans {
  const yt = p.trans.get(id);
  if (!yt) throw new EditError("UnknownId", `no transition \`${id}\``);
  return yt;
}

function checkTargets(p: YamlParsed, targets: readonly string[]): void {
  for (const t of targets) requireState(p.model, t);
}

function checkEvents(events: readonly string[]): void {
  for (const e of events) if (!e || /\s/.test(e)) throw new EditError("InvalidId", `\`${e}\` is not an event descriptor`);
}

function allScalars(seq: YAMLSeq): boolean {
  return seq.items.length > 0 && seq.items.every((n) => isScalar(n) && !isNull(n));
}

// ------------------------------------------------------------------------------ transitions

interface TSpec {
  readonly events: readonly string[];
  readonly targets: readonly string[];
  readonly cond?: string;
  readonly type: "external" | "internal";
  readonly actions: readonly ContentItem[];
}

function colFn(t: string) {
  return (o: number) => columnOf(t, o);
}

/** A transition's YAML value: a target (list) when simple, a mapping otherwise. */
function transYV(t: string, spec: TSpec, asItem: boolean, withEvent = false): YV {
  const simple = spec.cond === undefined && spec.type !== "internal" && spec.actions.length === 0;
  if (simple && !asItem && !withEvent) return spec.targets.length === 0 ? NULL : targetsYV(spec.targets);
  const entries: [string, YV][] = [];
  if (withEvent && spec.events.length > 0) entries.push(["event", S(spec.events.join(" "))]);
  if (spec.cond !== undefined) entries.push(["cond", S(spec.cond)]);
  if (spec.targets.length > 0) entries.push(["target", targetsYV(spec.targets)]);
  if (spec.type === "internal") entries.push(["type", S("internal")]);
  if (spec.actions.length > 0) entries.push(["actions", { seq: spec.actions.map((a) => contentYV(a, colFn(t))) }]);
  return { map: entries, flow: true };
}

/** The current transition as an item of a group list. */
function existingItemYV(t: string, node: unknown): YV {
  if (isNull(node)) return { map: [], flow: true };
  if (isScalar(node)) return { map: [["target", { s: t.slice(start(node), contentEnd(t, node)) }]], flow: true };
  if (isSeq(node)) return { map: [["target", { s: t.slice(start(node), contentEnd(t, node)) }]], flow: true };
  return { raw: t.slice(start(node), contentEnd(t, node)), col: columnOf(t, start(node)) };
}

/** Add a transition to the end of a state's `on` group / `always` / `transitions` list. */
function insertTransition(s: Session, source: string, spec: TSpec): void {
  const p = s.parsed;
  const t = p.text;
  const ys = yState(p, source);
  const sm = ys.map;
  const flowParent = !!ys.container.flow;
  const list = sm ? asSeq(getPair(sm, "transitions")?.value) : null;
  if (list) {
    s.commit([appendToSeq(s, list, transYV(t, spec, true, true))]);
    return;
  }
  const addToGroup = (group: YPair, inFlow: boolean) => {
    const v = group.value;
    const seq = asSeq(v);
    if (seq && !allScalars(seq) && seq.items.length > 0) {
      s.commit([appendToSeq(s, seq, transYV(t, spec, true))]);
      return;
    }
    const both: YV = { seq: [existingItemYV(t, v), transYV(t, spec, true)] };
    s.commit([replaceValue(s, group, both, inFlow)]);
  };
  if (spec.events.length > 0) {
    const desc = spec.events.join(" ");
    const onPair = sm ? getPair(sm, "on") : undefined;
    const onMap = asMap(onPair?.value);
    if (!onPair || (!onMap && isNull(onPair.value))) {
      const v: YV = { map: [[desc, transYV(t, spec, false)]], block: !(sm?.flow || flowParent) };
      s.commit([onPair ? replaceValue(s, onPair, v, !!sm?.flow) : setInHolder(s, ys.pair, flowParent, "on", v)]);
      return;
    }
    if (!onMap) throw new EditError("Unsupported", `\`on\` of \`${source}\` is not a mapping`);
    const g = getPair(onMap, desc);
    if (g) addToGroup(g, !!onMap.flow);
    else s.commit([setInMap(s, onMap, desc, transYV(t, spec, false))]);
    return;
  }
  const al = sm ? getPair(sm, "always") : undefined;
  if (al) addToGroup(al, !!sm!.flow);
  else s.commit([setInHolder(s, ys.pair, flowParent, "always", transYV(t, spec, false))]);
}

/** Remove a transition, dropping emptied groups and keeping list semantics intact. */
function deleteTransition(s: Session, id: string): void {
  const p = s.parsed;
  const t = p.text;
  const yt = yTrans(p, id);
  const ys = yState(p, p.model.transitions.get(id)!.source);
  const loc = yt.loc;
  if (loc.kind === "list") {
    if (loc.seq.items.length === 1) s.commit([removeFromState(s, ys, getPair(ys.map!, "transitions")!)]);
    else s.commit([removeFromSeq(s, loc.seq, loc.node)]);
    return;
  }
  const dropGroup = () => {
    if (loc.key === "always" || loc.container.items.length === 1) {
      const pair = loc.key === "always" ? loc.pair : getPair(ys.map!, "on")!;
      s.commit([removeFromState(s, ys, pair)]);
    } else s.commit([removeFromMap(s, loc.container, loc.pair)]);
  };
  if (!loc.seq || loc.seq.items.length === 1) return dropGroup();
  const patches = [removeFromSeq(s, loc.seq, loc.node)];
  const rest = loc.seq.items.filter((n) => n !== loc.node);
  if (rest.length >= 2 && rest.every((n) => isScalar(n) && !isNull(n))) {
    // A list of plain targets would read back as one transition with several targets.
    for (const n of rest) patches.push({ start: start(n), end: contentEnd(t, n), text: `{ target: ${t.slice(start(n), contentEnd(t, n))} }` });
  }
  s.commit(patches);
}

function specOf(p: YamlParsed, id: string): TSpec {
  const tn = p.model.transitions.get(id)!;
  return { events: tn.events, targets: tn.targets, ...(tn.cond !== undefined ? { cond: tn.cond } : {}), type: tn.type, actions: tn.actions };
}

function addTransition(s: Session, cmd: Extract<Command, { type: "addTransition" }>): void {
  const p = s.parsed;
  requireState(p.model, cmd.source);
  checkTargets(p, cmd.targets);
  checkEvents(cmd.events ?? []);
  if (p.model.states.get(cmd.source)!.kind === "final") throw new EditError("Unsupported", "a final state cannot have transitions");
  insertTransition(s, cmd.source, {
    events: cmd.events ?? [],
    targets: cmd.targets,
    ...(cmd.cond !== undefined ? { cond: cmd.cond } : {}),
    type: cmd.transitionType ?? "external",
    actions: [],
  });
}

function updateTransition(s: Session, cmd: Extract<Command, { type: "updateTransition" }>): void {
  const p = s.parsed;
  const yt = yTrans(p, cmd.id);
  const cur = specOf(p, cmd.id);
  const source = p.model.transitions.get(cmd.id)!.source;
  if (cmd.targets) checkTargets(p, cmd.targets);
  if (cmd.events) checkEvents(cmd.events);
  if (cmd.source !== undefined) {
    requireState(p.model, cmd.source);
    if (p.model.states.get(cmd.source)!.kind === "final") throw new EditError("Unsupported", "a final state cannot have transitions");
  }
  const cond = cmd.cond === null ? undefined : (cmd.cond ?? cur.cond);
  const next: TSpec = {
    events: cmd.events ?? cur.events,
    targets: cmd.targets ?? cur.targets,
    ...(cond !== undefined ? { cond } : {}),
    type: cmd.transitionType ?? cur.type,
    actions: cur.actions,
  };
  const newSource = cmd.source ?? source;
  const eventsChanged = cmd.events !== undefined && cmd.events.join(" ") !== cur.events.join(" ");
  const loc = yt.loc;
  if (newSource !== source || (eventsChanged && loc.kind === "group")) {
    const desc = next.events.join(" ");
    const canRenameKey =
      newSource === source && loc.kind === "group" && loc.key === "on" && !loc.seq && next.events.length > 0 && !getPair(loc.container, desc);
    if (!canRenameKey) {
      deleteTransition(s, cmd.id);
      insertTransition(s, newSource, next);
      return;
    }
    s.commit([renameKey(loc.pair, desc)]);
  } else if (eventsChanged && loc.kind === "list") {
    const m = yt.map!;
    const ep = getPair(m, "event");
    s.commit([next.events.length > 0 ? setInMap(s, m, "event", S(next.events.join(" "))) : removeFromMap(s, m, ep!)]);
  }
  // In-place edits of target, cond and type.
  const q2 = s.parsed;
  const yt2 = yTrans(q2, cmd.id);
  if (yt2.map) {
    const edits: [string, YV | null][] = [];
    if (cmd.targets) edits.push(["target", cmd.targets.length ? targetsYV(cmd.targets) : null]);
    if (cmd.cond !== undefined) edits.push(["cond", cmd.cond === null ? null : S(cmd.cond)]);
    if (cmd.transitionType === "internal") edits.push(["type", S("internal")]);
    else if (cmd.transitionType === "external" && getPair(yt2.map, "type")) edits.push(["type", S("external")]);
    for (const [k, v] of edits) {
      const m = yTrans(s.parsed, cmd.id).map!;
      const pair = getPair(m, k);
      if (v) s.commit([setInMap(s, m, k, v)]);
      else if (pair) s.commit([removeFromMap(s, m, pair)]);
    }
    return;
  }
  const asItem = yt2.loc.kind === "group" && yt2.loc.seq !== null;
  const v = transYV(q2.text, next, asItem);
  if (yt2.loc.kind === "group" && !yt2.loc.seq) s.commit([replaceValue(s, yt2.loc.pair, v, !!yt2.loc.container.flow)]);
  else s.commit([replaceNode(s, yt2.loc.node, v)]);
}

// ------------------------------------------------------------------------------ content

function reuser(t: string, old: readonly ContentItem[]): (i: ContentItem) => YV {
  const byStart = new Map<number, ContentItem>();
  const walk = (items: readonly ContentItem[]) => {
    for (const i of items) {
      if (i.span) byStart.set(i.span.start, i);
      if (i.kind === "if") for (const b of i.branches) walk(b.actions);
      if (i.kind === "foreach") walk(i.actions);
    }
  };
  walk(old);
  return (i) => {
    const o = i.span ? byStart.get(i.span.start) : undefined;
    if (o?.span && i.span && o.span.end === i.span.end && sameItem(o, i)) {
      return { raw: t.slice(o.span.start, o.span.end), col: columnOf(t, o.span.start) };
    }
    return contentYV(i, colFn(t));
  };
}

/** Patch a block sequence of content items, touching only the changed middle. */
function seqContentPatch(s: Session, seq: YAMLSeq, old: readonly ContentItem[], items: readonly ContentItem[]): TextPatch[] {
  const t = s.text;
  const unit = detectUnit(s.parsed);
  const nodes = seq.items;
  const ind = indentOf(t, dashOf(t, nodes[0]));
  const yv = reuser(t, old);
  const render = (i: ContentItem) => `- ${itemText(yv(i), ind + "  ", unit)}`;
  const [k, m] = commonEnds(old, items);
  if (k === old.length && k === items.length) return [];
  const mid = items.slice(k, items.length - m).map(render);
  const sep = `\n${ind}`;
  const n = nodes.length;
  const end = (i: number) => contentEnd(t, nodes[i]);
  const dash = (i: number) => dashOf(t, nodes[i]);
  if (k > 0 && m > 0) return [{ start: end(k - 1), end: dash(n - m), text: mid.map((r) => sep + r).join("") + sep }];
  if (k > 0) return [{ start: end(k - 1), end: end(n - 1), text: mid.map((r) => sep + r).join("") }];
  if (m > 0) return [{ start: dash(0), end: dash(n - m), text: mid.map((r) => r + sep).join("") }];
  return [{ start: dash(0), end: end(n - 1), text: mid.join(sep) }];
}

/** Set the content list under `key` of a mapping (`entry`/`exit` of a state, `actions`). */
function setContentList(
  s: Session,
  map: YAMLMap | null,
  key: string,
  old: readonly ContentItem[],
  oldBlocks: number,
  items: readonly ContentItem[],
  set: (v: YV) => TextPatch,
  remove: (pair: YPair) => TextPatch,
): void {
  const t = s.text;
  const pair = map ? getPair(map, key) : undefined;
  if (items.length === 0) {
    if (pair) s.commit([remove(pair)]);
    return;
  }
  const seq = asSeq(pair?.value);
  if (pair && seq && !seq.flow && seq.items.length > 0 && oldBlocks === 1) {
    s.commit(seqContentPatch(s, seq, old, items));
    return;
  }
  const yv = reuser(t, old);
  s.commit([set({ seq: items.map(yv) })]);
}

function setContent(s: Session, owner: ContentOwner, items: readonly ContentItem[]): void {
  const p = s.parsed;
  if ("transition" in owner) {
    const yt = yTrans(p, owner.transition);
    const tn = p.model.transitions.get(owner.transition)!;
    if (yt.map) {
      const m = yt.map;
      setContentList(s, m, "actions", tn.actions, 1, items, (v) => setInMap(s, m, "actions", v), (pair) => removeFromMap(s, m, pair));
      return;
    }
    if (items.length === 0) return;
    const spec: TSpec = { ...specOf(p, owner.transition), actions: items };
    const loc = yt.loc;
    if (loc.kind === "group" && !loc.seq) {
      const v = transYV(p.text, spec, false);
      s.commit([replaceValue(s, loc.pair, { ...(v as { map: [string, YV][] }), flow: false }, !!loc.container.flow)]);
    } else s.commit([replaceNode(s, loc.node, transYV(p.text, spec, true))]);
    return;
  }
  requireState(p.model, owner.state);
  const ys = yState(p, owner.state);
  const st = p.model.states.get(owner.state)!;
  const key = owner.slot === "onentry" ? "entry" : "exit";
  const blocks = st[owner.slot];
  const old = blocks.flatMap((b) => b.items);
  setContentList(
    s,
    ys.map,
    key,
    old,
    blocks.length,
    items,
    (v) => {
      const pair = ys.map ? getPair(ys.map, key) : undefined;
      return pair ? replaceValue(s, pair, v, !!ys.map!.flow) : setInHolder(s, ys.pair, !!ys.container.flow, key, v);
    },
    (pair) => removeFromState(s, ys, pair),
  );
}

// ------------------------------------------------------------------------------ states

function stateKindYV(kind: string, historyType?: "shallow" | "deep"): YV {
  if (kind === "parallel" || kind === "final") return { map: [["type", S(kind)]], flow: true };
  if (kind === "history") return { map: [["type", S("history")], ...(historyType === "deep" ? [["history", S("deep")] as const] : [])], flow: true };
  return { map: [], flow: true };
}

function addState(s: Session, cmd: Extract<Command, { type: "addState" }>): void {
  const p = s.parsed;
  if (cmd.parent !== null) {
    requireState(p.model, cmd.parent);
    const k = p.model.states.get(cmd.parent)!.kind;
    if (k === "history" || k === "final") throw new EditError("Unsupported", `a ${k} state cannot have children`);
  }
  if (cmd.kind === "history" && cmd.parent === null) throw new EditError("Unsupported", "a history state needs a parent");
  const id = cmd.id ?? uniqueId(p.model, idBase(cmd.kind));
  checkNewId(p.model, id);
  const v = stateKindYV(cmd.kind, cmd.historyType);
  insertStateEntry(s, cmd.parent, id, v);
  if (cmd.layout) writeLayout(s, { [id]: cmd.layout }, {});
}

/** Add `id: <value>` at the end of a parent's `states` mapping (creating it if needed). */
function insertStateEntry(s: Session, parent: string | null, id: string, v: YV | { rawEntry: string; col: number }): void {
  const p = s.parsed;
  const t = p.text;
  const unit = detectUnit(p);
  const holderMap = parent === null ? p.root : yState(p, parent).map;
  const statesPair = holderMap ? getPair(holderMap, "states") : undefined;
  const sm = asMap(statesPair?.value);
  if ("rawEntry" in v) {
    // A moved entry: re-indent its text to the new column.
    if (sm && sm.items.length > 0 && !sm.flow) {
      const items = sm.items as YPair[];
      const ind = indentOf(t, start(items[0]!.key));
      const at = eol(t, pairEnd(t, items[items.length - 1]!));
      s.commit([{ start: at, end: at, text: `\n${ind}${reindent(v.rawEntry, v.col, ind.length)}` }]);
      return;
    }
    if (sm && sm.flow) {
      const items = sm.items as YPair[];
      const flat = v.rawEntry;
      if (flat.includes("\n")) throw new EditError("Unsupported", "cannot move a block state into a flow `states` mapping");
      if (items.length === 0) s.commit([{ start: start(sm), end: sm.range![1], text: `{ ${flat} }` }]);
      else {
        const at = pairEnd(t, items[items.length - 1]!);
        s.commit([{ start: at, end: at, text: `, ${flat}` }]);
      }
      return;
    }
    // No states mapping yet: create it in the parent.
    const ys = parent === null ? null : yState(p, parent);
    const baseCol = ys ? columnOf(t, start(ys.pair.key)) + unit.length : 0;
    const ind = " ".repeat(baseCol + unit.length);
    const body = `\n${ind}${reindent(v.rawEntry, v.col, ind.length)}`;
    if (statesPair) {
      s.commit([{ start: colonEnd(t, statesPair), end: isEmptyNull(statesPair.value) ? colonEnd(t, statesPair) : contentEnd(t, statesPair.value), text: body }]);
      return;
    }
    if (!ys) {
      const items = p.root.items as YPair[];
      const at = eol(t, pairEnd(t, items[items.length - 1]!));
      s.commit([{ start: at, end: at, text: `\nstates:${body}` }]);
      return;
    }
    if (ys.container.flow) throw new EditError("Unsupported", "cannot move a block state into a flow state");
    const m = ys.map;
    const sInd = " ".repeat(baseCol);
    if (m && m.items.length > 0 && !m.flow) {
      const items = m.items as YPair[];
      const at = eol(t, pairEnd(t, items[items.length - 1]!));
      s.commit([{ start: at, end: at, text: `\n${sInd}states:${body}` }]);
    } else if (!m || m.items.length === 0) {
      const c = colonEnd(t, ys.pair);
      s.commit([{ start: c, end: isEmptyNull(ys.pair.value) ? c : contentEnd(t, ys.pair.value), text: `\n${sInd}states:${body}` }]);
    } else throw new EditError("Unsupported", "cannot move a block state into a flow state");
    return;
  }
  if (sm && sm.items.length > 0) {
    s.commit([setInMap(s, sm, id, v)]);
    return;
  }
  const entries: YV = { map: [[id, v]], block: true };
  if (statesPair) {
    s.commit([replaceValue(s, statesPair, entries, !!holderMap!.flow)]);
    return;
  }
  if (parent === null) {
    s.commit([setInMap(s, p.root, "states", entries)]);
    return;
  }
  const ys = yState(p, parent);
  const flowParent = !!ys.container.flow || !!(ys.map && ys.map.flow && ys.map.items.length > 0);
  s.commit([setInHolder(s, ys.pair, flowParent, "states", flowParent ? { map: [[id, v]], flow: true } : entries)]);
}

/** Remove a state entry; an emptied nested `states` mapping goes too. */
function deleteStateEntry(s: Session, id: string): void {
  const p = s.parsed;
  const ys = yState(p, id);
  const parent = p.model.states.get(id)!.parent;
  if (ys.container.items.length === 1) {
    if (parent === null) {
      s.commit([{ start: start(ys.container), end: contentEnd(p.text, ys.container), text: "{}" }]);
      return;
    }
    const pys = yState(p, parent);
    s.commit([removeFromState(s, pys, getPair(pys.map!, "states")!)]);
    return;
  }
  s.commit([removeFromMap(s, ys.container, ys.pair)]);
}

/** Drop references to `gone` ids from targets and `initial` keys of states outside `skip`. */
function dropReferences(s: Session, gone: ReadonlySet<string>, skip: ReadonlySet<string>): void {
  // Transitions: one at a time, re-reading after every commit.
  for (;;) {
    const p = s.parsed;
    const hit = [...p.model.transitions.values()].find((tn) => !skip.has(tn.source) && tn.targets.some((x) => gone.has(x)));
    if (!hit) break;
    const rest = hit.targets.filter((x) => !gone.has(x));
    if (rest.length === 0) deleteTransition(s, hit.id);
    else updateTransition(s, { type: "updateTransition", id: hit.id, targets: rest });
  }
  for (;;) {
    const p = s.parsed;
    const holder = [null, ...p.model.states.keys()].find((h) => {
      if (h !== null && skip.has(h)) return false;
      const init = h === null ? p.model.initial : p.model.states.get(h)!.initial;
      return init.some((x) => gone.has(x));
    });
    if (holder === undefined) break;
    const init = holder === null ? p.model.initial : p.model.states.get(holder)!.initial;
    setInitial(s, holder, init.filter((x) => !gone.has(x)), false);
  }
}

function removeState(s: Session, id: string): void {
  checkRemovable(s.model, id);
  const gone = subtree(s.model, id);
  dropReferences(s, gone, gone);
  deleteStateEntry(s, id);
  for (const g of gone) removeLayoutEntry(s, "states", g);
}

function renameState(s: Session, id: string, newId: string): void {
  const p = s.parsed;
  requireState(p.model, id);
  if (id === newId) return;
  checkNewId(p.model, newId);
  const t = p.text;
  const patches: TextPatch[] = [renameKey(yState(p, id).pair, newId)];
  const retarget = (v: unknown) => {
    if (isScalar(v) && str(v) === id) patches.push({ start: start(v), end: contentEnd(t, v), text: q(newId) });
    else if (isSeq(v)) for (const n of v.items) if (isScalar(n) && str(n) === id) patches.push({ start: start(n), end: contentEnd(t, n), text: q(newId) });
  };
  for (const yt of p.trans.values()) {
    if (yt.map) retarget(getPair(yt.map, "target")?.value);
    else retarget(yt.loc.node);
  }
  retarget(getPair(p.root, "initial")?.value);
  for (const ys of p.states.values()) {
    if (!ys.map) continue;
    retarget(getPair(ys.map, "initial")?.value);
    const ie = asMap(getPair(ys.map, "initial_element")?.value);
    const it = ie ? asMap(getPair(ie, "transition")?.value) : null;
    if (it) retarget(getPair(it, "target")?.value);
  }
  const lp = p.layoutStates ? getPair(p.layoutStates, id) : undefined;
  if (lp && !getPair(p.layoutStates!, newId)) patches.push(renameKey(lp, newId));
  s.commit(patches);
}

function reparentState(s: Session, cmd: Extract<Command, { type: "reparentState" }>): void {
  const p = s.parsed;
  requireState(p.model, cmd.id);
  if (cmd.parent !== null) {
    requireState(p.model, cmd.parent);
    if (subtree(p.model, cmd.id).has(cmd.parent)) throw new EditError("Cycle", `\`${cmd.parent}\` is inside \`${cmd.id}\``);
    const k = p.model.states.get(cmd.parent)!.kind;
    if (k === "history" || k === "final") throw new EditError("Unsupported", `a ${k} state cannot have children`);
  }
  const moved = subtree(p.model, cmd.id);
  const newAnc = new Set<string>();
  for (let a = cmd.parent; a !== null; a = p.model.states.get(a)?.parent ?? null) newAnc.add(a);
  for (let a = p.model.states.get(cmd.id)!.parent; a !== null; a = s.model.states.get(a)?.parent ?? null) {
    if (newAnc.has(a)) continue;
    const init = s.model.states.get(a)!.initial;
    if (init.some((x) => moved.has(x))) setInitial(s, a, init.filter((x) => !moved.has(x)), false);
  }
  const q2 = s.parsed;
  const ys = yState(q2, cmd.id);
  const t = q2.text;
  const raw = t.slice(start(ys.pair.key), pairEnd(t, ys.pair));
  const col = columnOf(t, start(ys.pair.key));
  deleteStateEntry(s, cmd.id);
  insertStateEntry(s, cmd.parent, cmd.id, { rawEntry: raw, col });
  if (cmd.index !== undefined) moveToIndex(s, cmd.id, cmd.index);
}

/** Move a state entry before its sibling at `index` (after an append). */
function moveToIndex(s: Session, id: string, index: number): void {
  const p = s.parsed;
  const ys = yState(p, id);
  const items = ys.container.items as YPair[];
  if (ys.container.flow || index >= items.length - 1) return;
  const anchor = items[Math.max(0, index)]!;
  const t = p.text;
  if (!firstOnLine(t, start(anchor.key)) || !firstOnLine(t, start(ys.pair.key))) return;
  const del = wholeLines(t, start(ys.pair.key), pairEnd(t, ys.pair));
  const block = t.slice(del.start, del.end);
  const at = lineStart(t, start(anchor.key));
  s.commit([del, { start: at, end: at, text: block.endsWith("\n") ? block : block + "\n" }]);
}

function setStateKind(s: Session, cmd: Extract<Command, { type: "setStateKind" }>): void {
  const p = s.parsed;
  requireState(p.model, cmd.id);
  const st = p.model.states.get(cmd.id)!;
  const k = cmd.kind;
  if (k === "compound" && st.children.length === 0) throw new EditError("Unsupported", "add a child state to make a compound state");
  if (k === "atomic" && st.children.length > 0) throw new EditError("Unsupported", "remove the child states to make an atomic state");
  if ((k === "final" || k === "history") && st.children.length > 0) throw new EditError("Unsupported", `a ${k} state cannot have children`);
  if (k === "history" && st.parent === null) throw new EditError("Unsupported", "a history state needs a parent");
  if (k === "final" && st.transitions.length > 0) throw new EditError("Unsupported", "a final state cannot have transitions");
  if ((k === "final" || k === "history") && p.model.data.some((d) => d.owner === cmd.id)) throw new EditError("Unsupported", `a ${k} state has no datamodel`);
  const type = k === "atomic" || k === "compound" ? null : k;
  const edit = (key: string, v: YV | null) => {
    const ys = yState(s.parsed, cmd.id);
    const pair = ys.map ? getPair(ys.map, key) : undefined;
    if (v === null) {
      if (pair) s.commit([removeFromState(s, ys, pair)]);
    } else if (!pair || str(pair.value) !== (v as { s: string }).s) {
      s.commit([pair ? replaceValue(s, pair, v, !!ys.map!.flow) : setInHolder(s, ys.pair, !!ys.container.flow, key, v)]);
    }
  };
  edit("type", type ? S(type) : null);
  if (k !== "history") edit("history", null);
  else if (cmd.historyType !== undefined) edit("history", cmd.historyType === "deep" ? S("deep") : null);
  if (k === "parallel" || k === "final" || k === "history") {
    edit("initial", null);
  }
}

function setInitial(s: Session, state: string | null, initial: readonly string[], validate = true): void {
  const p = s.parsed;
  if (validate) checkInitial(p.model, state, initial);
  const v: YV | null = initial.length === 0 ? null : targetsYV(initial);
  if (state === null) {
    const pair = getPair(p.root, "initial");
    if (v === null) {
      if (pair) s.commit([removeFromMap(s, p.root, pair)]);
    } else s.commit([setInMap(s, p.root, "initial", v, "states")]);
    return;
  }
  const ys = yState(p, state);
  const ie = ys.map ? getPair(ys.map, "initial_element") : undefined;
  if (ie) {
    const iem = asMap(ie.value);
    const tm = iem ? asMap(getPair(iem, "transition")?.value) : null;
    if (v === null || !tm) s.commit([removeFromState(s, ys, ie)]);
    else s.commit([setInMap(s, tm, "target", v)]);
    return;
  }
  const pair = ys.map ? getPair(ys.map, "initial") : undefined;
  if (v === null) {
    if (pair) s.commit([removeFromState(s, ys, pair)]);
  } else s.commit([pair ? replaceValue(s, pair, v, !!ys.map!.flow) : setInHolder(s, ys.pair, !!ys.container.flow, "initial", v)]);
}

// ------------------------------------------------------------------------------ data

function addData(s: Session, cmd: Extract<Command, { type: "addData" }>): void {
  const p = s.parsed;
  checkDataOwner(p.model, cmd.owner);
  checkNewId(p.model, cmd.id);
  const entry: YV = {
    map: [...(cmd.dataType !== undefined ? [["type", S(cmd.dataType)] as const] : []), ...(cmd.expr !== undefined ? [["init", S(cmd.expr)] as const] : [])],
    flow: true,
  };
  const ys = cmd.owner === null ? null : yState(p, cmd.owner);
  const holderMap = ys ? ys.map : p.root;
  const ctx = holderMap ? getPair(holderMap, "context") : undefined;
  const cm = asMap(ctx?.value);
  const cs = asSeq(ctx?.value);
  if (cm && cm.items.length > 0) s.commit([setInMap(s, cm, cmd.id, entry)]);
  else if (cs && cs.items.length > 0) s.commit([appendToSeq(s, cs, { map: [["id", S(cmd.id)], ...(entry as { map: [string, YV][] }).map], flow: true })]);
  else {
    const v: YV = { map: [[cmd.id, entry]], block: !holderMap?.flow };
    if (ctx) s.commit([replaceValue(s, ctx, v, !!holderMap!.flow)]);
    else if (ys) s.commit([setInHolder(s, ys.pair, !!ys.container.flow, "context", v)]);
    else s.commit([setInMap(s, p.root, "context", v, getPair(p.root, "initial") ? "initial" : "states")]);
  }
}

function yData(p: YamlParsed, id: string) {
  const d = p.data.get(id);
  if (!d) throw new EditError("UnknownId", `no data item \`${id}\``);
  return d;
}

function removeData(s: Session, id: string): void {
  const p = s.parsed;
  const d = yData(p, id);
  if (d.container.items.length > 1) {
    s.commit([d.pair ? removeFromMap(s, d.container as YAMLMap, d.pair) : removeFromSeq(s, d.container as YAMLSeq, d.node)]);
    return;
  }
  if (d.owner === null) s.commit([removeFromMap(s, p.root, getPair(p.root, "context")!)]);
  else {
    const ys = yState(p, d.owner);
    s.commit([removeFromState(s, ys, getPair(ys.map!, "context")!)]);
  }
}

function updateData(s: Session, cmd: Extract<Command, { type: "updateData" }>): void {
  let id = cmd.id;
  yData(s.parsed, id);
  if (cmd.newId !== undefined && cmd.newId !== id) {
    checkNewId(s.model, cmd.newId);
    const d = yData(s.parsed, id);
    s.commit([d.pair ? renameKey(d.pair, cmd.newId) : setInMap(s, d.map!, "id", S(cmd.newId))]);
    id = cmd.newId;
  }
  const field = (key: string, v: string | null | undefined) => {
    if (v === undefined) return;
    const d = yData(s.parsed, id);
    const pair = d.map ? getPair(d.map, key) : undefined;
    if (v === null) {
      if (pair) s.commit([removeFromMap(s, d.map!, pair)]);
      return;
    }
    if (d.map && (d.map.items.length > 0 || d.map.flow)) s.commit([setInMap(s, d.map, key, S(v))]);
    else if (d.pair) s.commit([replaceValue(s, d.pair, { map: [[key, S(v)]], flow: true }, !!(d.container as YAMLMap).flow)]);
  };
  field("init", cmd.expr);
  field("type", cmd.dataType);
}

// ------------------------------------------------------------------------------ layout

function stateLayoutYV(l: StateLayout): YV {
  return {
    map: [["x", N(l.x)], ["y", N(l.y)], ["w", N(l.w)], ["h", N(l.h)], ...(l.collapsed ? [["collapsed", { s: "true" }] as const] : [])],
    flow: true,
  };
}

function transitionLayoutYV(l: TransitionLayout): YV {
  return {
    map: [
      ...(l.route && l.route.length > 0 ? [["route", { seq: l.route.map(([x, y]) => ({ seq: [N(x), N(y)] })) }] as const] : []),
      ...(l.label ? [["label", { seq: [N(l.label[0]), N(l.label[1])] }] as const] : []),
    ],
    flow: true,
  };
}

/** Remove one `layout.<section>.<key>` entry, dropping emptied mappings up to `layout`. */
function removeLayoutEntry(s: Session, section: "states" | "transitions", key: string): void {
  const p = s.parsed;
  const sec = section === "states" ? p.layoutStates : p.layoutTransitions;
  const pair = sec ? getPair(sec, key) : undefined;
  if (!sec || !pair) return;
  if (sec.items.length > 1) {
    s.commit([removeFromMap(s, sec, pair)]);
    return;
  }
  const lm = asMap(p.layoutPair!.value)!;
  if (lm.items.length > 1) s.commit([removeFromMap(s, lm, getPair(lm, section)!)]);
  else s.commit([removeFromMap(s, p.root, p.layoutPair!)]);
}

/** Set layout entries in one section, creating `layout`/section mappings as needed. */
// @tg: implements:: [[openspec:chart-layout#Layout never changes the chart hash]] {note: "layout is written only into the top-level layout block, which vertep treats as formatting"}
function setLayoutEntries(s: Session, section: "states" | "transitions", entries: readonly [string, YV][]): void {
  if (entries.length === 0) return;
  let rest = entries;
  const p = s.parsed;
  const sec = section === "states" ? p.layoutStates : p.layoutTransitions;
  if (!sec || sec.items.length === 0) {
    const [first, ...others] = rest as [[string, YV], ...[string, YV][]];
    const secYV: YV = { map: [first], block: true };
    const lm = asMap(p.layoutPair?.value);
    if (!p.layoutPair) s.commit([setInMap(s, p.root, "layout", { map: [[section, secYV]], block: true })]);
    else if (lm && lm.items.length > 0) s.commit([setInMap(s, lm, section, secYV)]);
    else s.commit([replaceValue(s, p.layoutPair, { map: [[section, secYV]], block: true }, false)]);
    rest = others;
    if (rest.length === 0) return;
  }
  const q2 = s.parsed;
  const map = (section === "states" ? q2.layoutStates : q2.layoutTransitions)!;
  if (map.flow) {
    for (const [k, v] of rest) {
      const m = (section === "states" ? s.parsed.layoutStates : s.parsed.layoutTransitions)!;
      s.commit([setInMap(s, m, k, v)]);
    }
    return;
  }
  // One commit: replace existing entries in place, append new ones after the last entry.
  const t = q2.text;
  const items = map.items as YPair[];
  const ind = indentOf(t, start(items[0]!.key));
  const patches: TextPatch[] = [];
  let appended = "";
  for (const [k, v] of rest) {
    const pair = getPair(map, k);
    if (pair) patches.push(replaceValue(s, pair, v, false));
    else appended += `\n${ind}${q(k)}: ${flow(v)}`;
  }
  if (appended) {
    const at = eol(t, pairEnd(t, items[items.length - 1]!));
    patches.push({ start: at, end: at, text: appended });
  }
  s.commit(patches);
}

function writeLayout(
  s: Session,
  states: Readonly<Record<string, StateLayout | null>>,
  transitions: Readonly<Record<string, TransitionLayout | null>>,
): void {
  const p = s.parsed;
  for (const id of Object.keys(states)) requireState(p.model, id);
  for (const id of Object.keys(transitions)) yTrans(p, id);
  setLayoutEntries(
    s,
    "states",
    Object.entries(states)
      .filter((e): e is [string, StateLayout] => e[1] !== null)
      .map(([k, l]) => [k, stateLayoutYV(l)]),
  );
  setLayoutEntries(
    s,
    "transitions",
    Object.entries(transitions)
      .filter((e): e is [string, TransitionLayout] => e[1] !== null && (!!e[1].label || !!e[1].route?.length))
      .map(([k, l]) => [k, transitionLayoutYV(l)]),
  );
  for (const [k, l] of Object.entries(states)) if (l === null) removeLayoutEntry(s, "states", k);
  for (const [k, l] of Object.entries(transitions)) if (l === null || (!l.label && !l.route?.length)) removeLayoutEntry(s, "transitions", k);
  // Orphans: entries for ids the chart no longer has.
  for (;;) {
    const q2 = s.parsed;
    const orphan = ((q2.layoutStates?.items ?? []) as YPair[]).map(keyStr).find((k) => k !== undefined && !q2.model.states.has(k));
    if (orphan === undefined) break;
    removeLayoutEntry(s, "states", orphan);
  }
  for (;;) {
    const q2 = s.parsed;
    const orphan = ((q2.layoutTransitions?.items ?? []) as YPair[]).map(keyStr).find((k) => k !== undefined && !q2.model.transitions.has(k));
    if (orphan === undefined) break;
    removeLayoutEntry(s, "transitions", orphan);
  }
}

/**
 * Keep `layout.transitions` keys (`source#index`) pointing at the same transitions after a
 * command renumbered, moved, renamed or removed transitions.
 */
function fixTransitionLayout(s: Session, before: YamlParsed, mark: Mark, renamed: ReadonlyMap<string, string>): void {
  const lt = s.parsed.layoutTransitions;
  if (!lt || !before.layoutTransitions) return;
  const now = s.model;
  const mapping = new Map<string, string | null>();
  const taken = new Set<string>();
  for (const tn of before.model.transitions.values()) {
    if (!getPair(before.layoutTransitions, tn.id)) continue;
    const src = renamed.get(tn.source) ?? tn.source;
    const ns = mapOffset(tn.span.start, mark.patches);
    const cands = [...now.transitions.values()].filter((n) => n.source === src && !taken.has(n.id));
    let found = ns === null ? undefined : cands.find((n) => n.span.start === ns);
    if (!found) {
      const tg = tn.targets.map((x) => renamed.get(x) ?? x).join(" ");
      found = cands.find((n) => n.events.join(" ") === tn.events.join(" ") && n.targets.join(" ") === tg && n.cond === tn.cond);
    }
    if (found) taken.add(found.id);
    mapping.set(tn.id, found?.id ?? null);
  }
  const t = s.text;
  const patches: TextPatch[] = [];
  const remove: string[] = [];
  const finalKeys = new Set<string>();
  for (const pair of lt.items as YPair[]) {
    const k = keyStr(pair);
    if (k === undefined || !mapping.has(k)) continue;
    const nk = mapping.get(k)!;
    if (nk === null) remove.push(k);
    else {
      finalKeys.add(nk);
      if (nk !== k) patches.push(renameKey(pair, nk));
    }
  }
  for (const pair of lt.items as YPair[]) {
    const k = keyStr(pair);
    if (k !== undefined && !mapping.has(k) && finalKeys.has(k)) patches.push(removeFromMap(s, lt, pair));
  }
  s.commit(patches);
  for (const k of remove) {
    // After renames, a removed key may now be someone else's; only remove if still unmapped.
    if (!finalKeys.has(k)) removeLayoutEntry(s, "transitions", k);
  }
}

// @tg: implements:: [[openspec:chart-document#Format-preserving edits]]
// @tg: implements:: [[openspec:chart-document#Rename updates references]]
// @tg: implements:: [[openspec:chart-document#Unmodeled content is preserved]]
// @tg: implements:: [[openspec:chart-layout#Layout is stored inline]]
// @tg: implements:: [[openspec:chart-layout#Stale layout is tolerated]]
/** The vertep YAML format: `yaml` CST, semantic view and command patches. */
export const yamlBackend: Backend<YamlParsed> = {
  format: "yaml",
  parse: parseVtYaml,
  apply(s, cmd) {
    const before = s.parsed;
    const mark = s.mark();
    try {
      run(s, cmd);
      if (cmd.type !== "setLayout") {
        const renamed = new Map<string, string>(cmd.type === "renameState" ? [[cmd.id, cmd.newId]] : []);
        fixTransitionLayout(s, before, mark, renamed);
      }
    } finally {
      s.release(mark);
    }
  },
};

function run(s: Session, cmd: Command): void {
  switch (cmd.type) {
    case "addState":
      return addState(s, cmd);
    case "removeState":
      return removeState(s, cmd.id);
    case "renameState":
      return renameState(s, cmd.id, cmd.newId);
    case "reparentState":
      return reparentState(s, cmd);
    case "setStateKind":
      return setStateKind(s, cmd);
    case "setInitial":
      return setInitial(s, cmd.state, cmd.initial);
    case "addTransition":
      return addTransition(s, cmd);
    case "removeTransition":
      return deleteTransition(s, cmd.id);
    case "updateTransition":
      return updateTransition(s, cmd);
    case "setContent":
      return setContent(s, cmd.owner, cmd.items);
    case "addData":
      return addData(s, cmd);
    case "updateData":
      return updateData(s, cmd);
    case "removeData":
      return removeData(s, cmd.id);
    case "setLayout":
      return writeLayout(s, cmd.states ?? {}, cmd.transitions ?? {});
    case "setChartProps": {
      if (cmd.name !== undefined) s.commit([setInMap(s, s.parsed.root, "name", cmd.name === null ? NULL : S(cmd.name), "states")]);
      if (cmd.datamodel !== undefined) {
        const pair = getPair(s.parsed.root, "datamodel");
        if (cmd.datamodel === null) {
          if (pair) s.commit([removeFromMap(s, s.parsed.root, pair)]);
        } else s.commit([setInMap(s, s.parsed.root, "datamodel", S(cmd.datamodel), "states")]);
      }
      return;
    }
  }
}
