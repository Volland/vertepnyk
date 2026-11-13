/**
 * The semantic view of a vertep YAML chart (see vertep-yaml's module docs for the dialect),
 * with back-pointers into the `yaml` document for edits.
 */
import { isMap, isScalar, isSeq, type Document, type YAMLMap, type YAMLSeq } from "yaml";
import type {
  ChartModel,
  ContentBlock,
  ContentItem,
  DataItem,
  StateKind,
  StateLayout,
  StateNode,
  TransitionLayout,
  TransitionNode,
} from "../model.js";
import type { Parsed } from "../backend.js";
import { ChartParseFailure } from "../errors.js";
import { asMap, asSeq, contentEnd, getPair, getVal, isNull, keyStr, pairEnd, parseYamlDocument, start, str, type YPair } from "./cst.js";

export interface YState {
  readonly id: string;
  /** The `id: {...}` entry in its `states` mapping. */
  readonly pair: YPair;
  readonly map: YAMLMap | null;
  readonly container: YAMLMap;
}

export type YTransLoc =
  /** In an `on` descriptor group or `always`; `seq` when the group is a list of transitions. */
  | { readonly kind: "group"; readonly key: "on" | "always"; readonly pair: YPair; readonly container: YAMLMap; readonly seq: YAMLSeq | null; readonly node: unknown }
  /** An item of the `transitions` list. */
  | { readonly kind: "list"; readonly seq: YAMLSeq; readonly node: unknown };

export interface YTrans {
  readonly id: string;
  readonly loc: YTransLoc;
  /** The transition's mapping, when it is written as one. */
  readonly map: YAMLMap | null;
}

export interface YData {
  readonly id: string;
  readonly owner: string | null;
  readonly container: YAMLMap | YAMLSeq;
  /** Map form: the `id: {...}` entry. List form: undefined. */
  readonly pair?: YPair;
  /** The entry's mapping (map form: the value; list form: the item). */
  readonly map: YAMLMap | null;
  readonly node: unknown;
}

export interface YamlParsed extends Parsed {
  readonly doc: Document.Parsed;
  readonly root: YAMLMap;
  readonly states: ReadonlyMap<string, YState>;
  readonly trans: ReadonlyMap<string, YTrans>;
  readonly data: ReadonlyMap<string, YData>;
  readonly layoutPair: YPair | undefined;
  readonly layoutStates: YAMLMap | null;
  readonly layoutTransitions: YAMLMap | null;
}

const ACTION_KEYS = ["assign", "raise", "send", "log", "if", "foreach", "cancel", "script", "call", "extension"];

function scalarList(v: unknown): string[] {
  if (isSeq(v)) return (v as YAMLSeq).items.map(str).filter((x): x is string => x !== undefined);
  const s = str(v);
  return s === undefined ? [] : [s];
}

function flagged(v: unknown): string | undefined {
  const m = asMap(v);
  return m ? str(getVal(m, "value")) : str(v);
}

function num(v: unknown): number | undefined {
  if (!isScalar(v)) return undefined;
  const n = typeof v.value === "number" ? v.value : typeof v.value === "string" && v.value.trim() !== "" ? Number(v.value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function point(v: unknown): [number, number] | undefined {
  const s = asSeq(v);
  if (!s || s.items.length !== 2) return undefined;
  const x = num(s.items[0]);
  const y = num(s.items[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** Parse a vertep YAML text. Throws `ChartParseFailure`. */
export function parseVtYaml(text: string): YamlParsed {
  const doc = parseYamlDocument(text);
  const root = asMap(doc.contents);
  if (!root) throw new ChartParseFailure(text, doc.contents ? start(doc.contents) : 0, "a chart document must be a mapping");
  return new YamlBuilder(text, doc, root).build();
}

class YamlBuilder {
  private readonly states = new Map<string, StateNode>();
  private readonly transitions = new Map<string, TransitionNode>();
  private readonly data: DataItem[] = [];
  private readonly yStates = new Map<string, YState>();
  private readonly yTrans = new Map<string, YTrans>();
  private readonly yData = new Map<string, YData>();

  constructor(
    private readonly text: string,
    private readonly doc: Document.Parsed,
    private readonly root: YAMLMap,
  ) {}

  build(): YamlParsed {
    const root = this.root;
    this.context(getVal(root, "context"), null);
    const statesMap = asMap(getVal(root, "states"));
    const roots = statesMap ? this.stateMap(statesMap, null) : [];
    const events = new Set<string>();
    const eventTypes = new Map<string, string>();
    const ev = asMap(getVal(root, "events"));
    if (ev) {
      for (const p of ev.items as YPair[]) {
        const k = keyStr(p);
        if (k === undefined) continue;
        events.add(k);
        if (!isNull(p.value)) {
          const t = str(p.value) ?? this.text.slice(start(p.value), contentEnd(this.text, p.value));
          eventTypes.set(k, t);
        }
      }
    }
    for (const t of this.transitions.values()) for (const e of t.events) events.add(e);
    const layoutPair = getPair(root, "layout");
    const lm = asMap(layoutPair?.value);
    const layoutStates = asMap(getVal(lm, "states"));
    const layoutTransitions = asMap(getVal(lm, "transitions"));
    const layout = new Map<string, StateLayout>();
    for (const p of (layoutStates?.items ?? []) as YPair[]) {
      const id = keyStr(p);
      const m = asMap(p.value);
      if (id === undefined || !m || !this.states.has(id)) continue;
      const [x, y, w, h] = ["x", "y", "w", "h"].map((k) => num(getVal(m, k)));
      if (x === undefined || y === undefined || w === undefined || h === undefined || w < 0 || h < 0) continue;
      const c = getVal(m, "collapsed");
      layout.set(id, isScalar(c) && c.value === true ? { x, y, w, h, collapsed: true } : { x, y, w, h });
    }
    const tLayout = new Map<string, TransitionLayout>();
    for (const p of (layoutTransitions?.items ?? []) as YPair[]) {
      const id = keyStr(p);
      const m = asMap(p.value);
      if (id === undefined || !m || !this.transitions.has(id)) continue;
      const rs = asSeq(getVal(m, "route"));
      const pts = rs?.items.map(point);
      const route = pts && pts.every((x) => x !== undefined) ? (pts as [number, number][]) : undefined;
      const label = point(getVal(m, "label"));
      if (route || label) tLayout.set(id, { ...(route ? { route } : {}), ...(label ? { label } : {}) });
    }
    const name = str(getVal(root, "name"));
    const datamodel = flagged(getVal(root, "datamodel"));
    const model: ChartModel = {
      format: "yaml",
      ...(name !== undefined ? { name } : {}),
      ...(datamodel !== undefined ? { datamodel } : {}),
      initial: scalarList(getVal(root, "initial")),
      roots,
      states: this.states,
      transitions: this.transitions,
      data: this.data,
      events: [...events].sort(),
      eventTypes,
      layout,
      transitionLayout: tLayout,
    };
    return {
      text: this.text,
      model,
      doc: this.doc,
      root,
      states: this.yStates,
      trans: this.yTrans,
      data: this.yData,
      layoutPair,
      layoutStates,
      layoutTransitions,
    };
  }

  private stateMap(m: YAMLMap, parent: string | null): string[] {
    const out: string[] = [];
    for (const p of m.items as YPair[]) {
      const id = keyStr(p);
      if (id === undefined || this.states.has(id)) continue;
      out.push(this.state(id, p, m, parent));
    }
    return out;
  }

  private state(id: string, pair: YPair, container: YAMLMap, parent: string | null): string {
    const map = asMap(pair.value);
    this.yStates.set(id, { id, pair, map, container });
    const type = str(getVal(map, "type"));
    const childMap = asMap(getVal(map, "states"));
    const node: StateNode = {
      id,
      kind: "atomic",
      parent,
      children: [],
      initial: [],
      initialSource: "implicit",
      transitions: [],
      onentry: [],
      onexit: [],
      generatedId: isScalar(getVal(map, "generated")) && (getVal(map, "generated") as { value: unknown }).value === true,
      span: { start: start(pair.key), end: pairEnd(this.text, pair) },
    };
    this.states.set(id, node);
    let initial = scalarList(getVal(map, "initial"));
    let initialSource: StateNode["initialSource"] = initial.length > 0 ? "attribute" : "implicit";
    const ie = asMap(getVal(map, "initial_element"));
    const it = asMap(getVal(ie, "transition"));
    if (it) {
      initial = scalarList(getVal(it, "target"));
      initialSource = "element";
    }
    const tids: string[] = [];
    const add = (loc: YTransLoc, node: unknown, events: string[]) => {
      const id2 = `${id}#${tids.length}`;
      const tm = asMap(node);
      this.transitions.set(id2, this.transition(id2, id, tids.length, node, events));
      this.yTrans.set(id2, { id: id2, loc, map: tm });
      tids.push(id2);
    };
    for (const p of (map?.items ?? []) as YPair[]) {
      const k = keyStr(p);
      if (k === "on") {
        const om = asMap(p.value);
        for (const g of (om?.items ?? []) as YPair[]) {
          const desc = keyStr(g);
          if (desc === undefined) continue;
          this.group(g, "on", om!, desc.split(/\s+/).filter(Boolean), add);
        }
      } else if (k === "always") {
        this.group(p, "always", map!, [], add);
      } else if (k === "transitions") {
        const seq = asSeq(p.value);
        for (const n of seq?.items ?? []) {
          if (!isMap(n)) continue;
          const e = getVal(n as YAMLMap, "event");
          const events = isSeq(e) ? scalarList(e) : (str(e) ?? "").split(/\s+/).filter(Boolean);
          add({ kind: "list", seq: seq!, node: n }, n, events);
        }
      } else if (k === "context") {
        this.context(p.value, id);
      }
    }
    const onentry = this.blocks(getVal(map, "entry"));
    const onexit = this.blocks(getVal(map, "exit"));
    const children = childMap ? this.stateMap(childMap, id) : [];
    let kind: StateKind;
    if (type === "parallel") kind = "parallel";
    else if (type === "final") kind = "final";
    else if (type === "history") kind = "history";
    else kind = children.length > 0 ? "compound" : "atomic";
    Object.assign(node, {
      kind,
      ...(kind === "history" ? { historyType: str(getVal(map, "history")) === "deep" ? "deep" : "shallow" } : {}),
      children,
      initial,
      initialSource,
      transitions: tids,
      onentry,
      onexit,
    });
    return id;
  }

  private group(pair: YPair, key: "on" | "always", container: YAMLMap, events: string[], add: (loc: YTransLoc, node: unknown, events: string[]) => void): void {
    const v = pair.value;
    const seq = asSeq(v);
    if (seq && !(seq.items.length > 0 && seq.items.every((n) => isScalar(n) && !isNull(n)))) {
      for (const n of seq.items) {
        if (isSeq(n)) continue;
        add({ kind: "group", key, pair, container, seq, node: n }, n, events);
      }
      return;
    }
    add({ kind: "group", key, pair, container, seq: null, node: v }, v, events);
  }

  private transition(id: string, source: string, index: number, node: unknown, events: string[]): TransitionNode {
    const m = asMap(node);
    const targets = m ? scalarList(getVal(m, "target")) : isNull(node) ? [] : scalarList(node);
    const cond = m ? str(getVal(m, "cond")) : undefined;
    const type = m ? flagged(getVal(m, "type")) : undefined;
    const actions = m ? this.items(getVal(m, "actions")) : [];
    const s = node && typeof node === "object" && "range" in node ? start(node) : 0;
    return {
      id,
      source,
      index,
      events,
      ...(cond !== undefined ? { cond } : {}),
      targets,
      type: type === "internal" ? "internal" : "external",
      actions,
      span: { start: s, end: node && typeof node === "object" && "range" in node ? contentEnd(this.text, node) : s },
    };
  }

  private context(v: unknown, owner: string | null): void {
    const m = asMap(v);
    if (m) {
      for (const p of m.items as YPair[]) {
        const id = keyStr(p);
        if (id === undefined) continue;
        const dm = asMap(p.value);
        this.dataItem(id, owner, dm, { start: start(p.key), end: pairEnd(this.text, p) });
        if (!this.yData.has(id)) this.yData.set(id, { id, owner, container: m, pair: p, map: dm, node: p.value });
      }
      return;
    }
    const s = asSeq(v);
    for (const n of s?.items ?? []) {
      const dm = asMap(n);
      const id = str(getVal(dm, "id"));
      if (id === undefined) continue;
      this.dataItem(id, owner, dm, { start: start(n), end: contentEnd(this.text, n) });
      if (!this.yData.has(id)) this.yData.set(id, { id, owner, container: s!, map: dm, node: n });
    }
  }

  private dataItem(id: string, owner: string | null, m: YAMLMap | null, span: { start: number; end: number }): void {
    const expr = str(getVal(m, "init"));
    const tv = getVal(m, "type");
    const type = isNull(tv) ? undefined : (str(tv) ?? this.text.slice(start(tv), contentEnd(this.text, tv)));
    this.data.push({ id, ...(expr !== undefined ? { expr } : {}), ...(type !== undefined ? { type } : {}), owner, span });
  }

  private blocks(v: unknown): ContentBlock[] {
    if (isNull(v)) return [];
    const s = asSeq(v);
    if (s && s.items.length > 0 && s.items.every((n) => isSeq(n))) {
      return s.items.map((b) => ({ items: this.items(b), span: { start: start(b), end: contentEnd(this.text, b) } }));
    }
    return [{ items: this.items(v), span: { start: start(v), end: contentEnd(this.text, v) } }];
  }

  items(v: unknown): ContentItem[] {
    const s = asSeq(v);
    return s ? s.items.map((n) => this.item(n)) : [];
  }

  private item(n: unknown): ContentItem {
    const span = { start: start(n), end: contentEnd(this.text, n) };
    const m = asMap(n);
    const keys = ((m?.items ?? []) as YPair[]).map(keyStr);
    const action = keys.find((k): k is string => k !== undefined && ACTION_KEYS.includes(k));
    const opaque = (): ContentItem => ({ kind: "opaque", label: action ?? "item", source: this.text.slice(span.start, span.end), span });
    if (!m || keys.length !== 1 || action === undefined) return opaque();
    const v = getVal(m, action);
    const fields = (allowed: string[]): Record<string, string> | null => {
      const fm = asMap(v);
      if (!fm) return null;
      const out: Record<string, string> = {};
      for (const p of fm.items as YPair[]) {
        const k = keyStr(p);
        const val = str(p.value);
        if (k === undefined || !allowed.includes(k) || val === undefined) return null;
        out[k] = val;
      }
      return out;
    };
    switch (action) {
      case "raise": {
        const e = str(v);
        return e === undefined ? opaque() : { kind: "raise", event: e, span };
      }
      case "assign": {
        const f = fields(["location", "expr"]);
        return f?.location === undefined || f.expr === undefined ? opaque() : { kind: "assign", location: f.location, expr: f.expr, span };
      }
      case "log": {
        const f = fields(["label", "expr"]);
        return f ? { kind: "log", ...f, span } : opaque();
      }
      case "cancel": {
        const f = fields(["sendid", "sendidexpr"]);
        return f ? { kind: "cancel", ...f, span } : opaque();
      }
      case "send": {
        const fm = asMap(v);
        if (!fm) return opaque();
        const out: Record<string, string> = {};
        let params: { name: string; expr: string }[] | undefined;
        for (const p of fm.items as YPair[]) {
          const k = keyStr(p);
          if (k === "params") {
            const pm = asMap(p.value);
            if (!pm) return opaque();
            params = [];
            for (const pp of pm.items as YPair[]) {
              const name = keyStr(pp);
              const expr = str(pp.value);
              if (name === undefined || expr === undefined) return opaque();
              params.push({ name, expr });
            }
            continue;
          }
          const val = str(p.value);
          if (k === undefined || !["event", "eventexpr", "target", "type", "id", "delay"].includes(k) || val === undefined) return opaque();
          out[k === "id" ? "sendid" : k] = val;
        }
        return { kind: "send", ...out, ...(params && params.length > 0 ? { params } : {}), span };
      }
      case "if": {
        const bs = asSeq(v);
        if (!bs || bs.items.length === 0) return opaque();
        const branches: { cond?: string; actions: ContentItem[] }[] = [];
        for (const [i, b] of bs.items.entries()) {
          const bm = asMap(b);
          if (!bm || (bm.items as YPair[]).some((p) => !["cond", "do"].includes(keyStr(p) ?? ""))) return opaque();
          const cond = str(getVal(bm, "cond"));
          if (cond === undefined && i !== bs.items.length - 1) return opaque();
          if (i === 0 && cond === undefined) return opaque();
          branches.push({ ...(cond !== undefined ? { cond } : {}), actions: this.items(getVal(bm, "do")) });
        }
        return { kind: "if", branches, span };
      }
      case "foreach": {
        const fm = asMap(v);
        if (!fm || (fm.items as YPair[]).some((p) => !["array", "item", "index", "do"].includes(keyStr(p) ?? ""))) return opaque();
        const array = str(getVal(fm, "array"));
        const item = str(getVal(fm, "item"));
        const index = str(getVal(fm, "index"));
        if (array === undefined || item === undefined) return opaque();
        return { kind: "foreach", array, item, ...(index !== undefined ? { index } : {}), actions: this.items(getVal(fm, "do")), span };
      }
    }
    return opaque();
  }
}

