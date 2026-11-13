/**
 * The semantic view of an SCXML document: states, transitions, executable content, data and
 * layout, each with a back-pointer to its element in the lossless tree.
 */
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
import { SCXML_NS, VL_NS, type Parsed } from "../backend.js";
import { ChartParseFailure } from "../errors.js";
import { attr, attrNs, elementChildren, parseXml, type XDocument, type XElement, type XNode } from "./cst.js";

export const STATE_TAGS = new Set(["state", "parallel", "final", "history"]);
const GENERATED_PREFIX = "_vt.s";

export interface XmlParsed extends Parsed {
  readonly doc: XDocument;
  /** The namespace SCXML elements are in (the root's). */
  readonly scNs: string | null;
  readonly stateEls: ReadonlyMap<string, XElement>;
  readonly transitionEls: ReadonlyMap<string, XElement>;
  /** `<initial>` elements by owning state id. */
  readonly initialEls: ReadonlyMap<string, XElement>;
  /** `<data>` elements by id (first occurrence). */
  readonly dataEls: ReadonlyMap<string, XElement>;
  /** `<onentry>`/`<onexit>` elements by state id. */
  readonly blockEls: ReadonlyMap<string, { onentry: XElement[]; onexit: XElement[] }>;
}

export function isSc(p: { scNs: string | null }, el: XElement, local?: string): boolean {
  return el.ns === p.scNs && (local === undefined || el.local === local);
}

export function isStateEl(p: { scNs: string | null }, el: XElement): boolean {
  return el.ns === p.scNs && STATE_TAGS.has(el.local);
}

function splitWs(s: string | undefined): string[] {
  return s === undefined ? [] : s.split(/\s+/).filter((x) => x.length > 0);
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function parseStateLayout(get: (k: string) => string | undefined): StateLayout | undefined {
  const x = num(get("x"));
  const y = num(get("y"));
  const w = num(get("w"));
  const h = num(get("h"));
  if (x === undefined || y === undefined || w === undefined || h === undefined || w < 0 || h < 0) return undefined;
  const c = get("collapsed");
  return c === "true" ? { x, y, w, h, collapsed: true } : { x, y, w, h };
}

export function parsePoint(s: string): [number, number] | undefined {
  const parts = s.split(",");
  if (parts.length !== 2) return undefined;
  const x = num(parts[0]);
  const y = num(parts[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function parseRoute(s: string): [number, number][] | undefined {
  const out: [number, number][] = [];
  for (const p of splitWs(s)) {
    const pt = parsePoint(p);
    if (!pt) return undefined;
    out.push(pt);
  }
  return out;
}

/** Parse an SCXML text. Throws `ChartParseFailure`. */
export function parseScxml(text: string): XmlParsed {
  const doc = parseXml(text);
  const root = doc.root;
  if (root.local !== "scxml" || (root.ns !== SCXML_NS && root.ns !== null)) {
    throw new ChartParseFailure(text, root.start, `the root element is <${root.name}>, not <scxml>`);
  }
  return new XmlBuilder(text, doc).build();
}

class XmlBuilder {
  readonly scNs: string | null;
  private readonly states = new Map<string, StateNode>();
  private readonly transitions = new Map<string, TransitionNode>();
  private readonly data: DataItem[] = [];
  private readonly layout = new Map<string, StateLayout>();
  private readonly tLayout = new Map<string, TransitionLayout>();
  private readonly stateEls = new Map<string, XElement>();
  private readonly transitionEls = new Map<string, XElement>();
  private readonly initialEls = new Map<string, XElement>();
  private readonly dataEls = new Map<string, XElement>();
  private readonly blockEls = new Map<string, { onentry: XElement[]; onexit: XElement[] }>();
  private readonly ids = new Map<XElement, { id: string; generated: boolean }>();

  constructor(
    private readonly text: string,
    private readonly doc: XDocument,
  ) {
    this.scNs = doc.root.ns;
  }

  build(): XmlParsed {
    const root = this.doc.root;
    this.assignIds();
    for (const c of elementChildren(root)) if (isSc(this, c, "datamodel")) this.datamodel(c, null);
    const roots = this.stateChildren(root).map((el) => this.state(el, null));
    const events = new Set<string>();
    for (const t of this.transitions.values()) for (const e of t.events) events.add(e);
    const name = attr(root, "name")?.value;
    const datamodel = attr(root, "datamodel")?.value;
    const model: ChartModel = {
      format: "scxml",
      ...(name !== undefined ? { name } : {}),
      ...(datamodel !== undefined ? { datamodel } : {}),
      initial: splitWs(attr(root, "initial")?.value),
      roots,
      states: this.states,
      transitions: this.transitions,
      data: this.data,
      events: [...events].sort(),
      eventTypes: new Map(),
      layout: this.layout,
      transitionLayout: this.tLayout,
    };
    return {
      text: this.text,
      model,
      doc: this.doc,
      scNs: this.scNs,
      stateEls: this.stateEls,
      transitionEls: this.transitionEls,
      initialEls: this.initialEls,
      dataEls: this.dataEls,
      blockEls: this.blockEls,
    };
  }

  private stateChildren(el: XElement): XElement[] {
    return elementChildren(el).filter((c) => isStateEl(this, c));
  }

  /** Declared ids, then vertep's generated ids (`_vt.s.<i>.<j>...`) for id-less states. */
  private assignIds(): void {
    const taken = new Set<string>();
    const collect = (el: XElement) => {
      for (const c of this.stateChildren(el)) {
        const id = attr(c, "id")?.value;
        if (id) taken.add(id);
        collect(c);
      }
    };
    collect(this.doc.root);
    const assign = (el: XElement, path: number[]) => {
      this.stateChildren(el).forEach((c, i) => {
        const p = [...path, i];
        const id = attr(c, "id")?.value;
        if (id) this.ids.set(c, { id, generated: false });
        else {
          let gid = GENERATED_PREFIX + p.map((n) => `.${n}`).join("");
          while (taken.has(gid)) gid += "_";
          taken.add(gid);
          this.ids.set(c, { id: gid, generated: true });
        }
        assign(c, p);
      });
    };
    assign(this.doc.root, []);
  }

  private state(el: XElement, parent: string | null): string {
    const { id, generated } = this.ids.get(el)!;
    const kids = this.stateChildren(el);
    let kind: StateKind;
    if (el.local === "parallel") kind = "parallel";
    else if (el.local === "final") kind = "final";
    else if (el.local === "history") kind = "history";
    else kind = kids.length > 0 ? "compound" : "atomic";
    let initial = splitWs(attr(el, "initial")?.value);
    let initialSource: StateNode["initialSource"] = initial.length > 0 ? "attribute" : "implicit";
    const onentry: ContentBlock[] = [];
    const onexit: ContentBlock[] = [];
    const tids: string[] = [];
    const blocks = { onentry: [] as XElement[], onexit: [] as XElement[] };
    for (const c of elementChildren(el)) {
      if (!isSc(this, c)) continue;
      switch (c.local) {
        case "initial": {
          const t = elementChildren(c).find((x) => isSc(this, x, "transition"));
          this.initialEls.set(id, c);
          if (t) {
            initial = splitWs(attr(t, "target")?.value);
            initialSource = "element";
          }
          break;
        }
        case "onentry":
          blocks.onentry.push(c);
          onentry.push({ items: this.content(c), span: { start: c.start, end: c.end } });
          break;
        case "onexit":
          blocks.onexit.push(c);
          onexit.push({ items: this.content(c), span: { start: c.start, end: c.end } });
          break;
        case "transition":
          tids.push(this.transition(c, id, tids.length));
          break;
        case "datamodel":
          this.datamodel(c, id);
          break;
      }
    }
    this.stateEls.set(id, el);
    this.blockEls.set(id, blocks);
    const lay = parseStateLayout((k) => attrNs(el, VL_NS, k)?.value);
    if (lay) this.layout.set(id, lay);
    const node: StateNode = {
      id,
      kind,
      ...(kind === "history" ? { historyType: attr(el, "type")?.value === "deep" ? "deep" : "shallow" } : {}),
      parent,
      children: [],
      initial,
      initialSource,
      transitions: tids,
      onentry,
      onexit,
      generatedId: generated,
      span: { start: el.start, end: el.end },
    };
    this.states.set(id, node);
    const childIds = kids.map((c) => this.state(c, id));
    (node as { children: readonly string[] }).children = childIds;
    return id;
  }

  private transition(el: XElement, source: string, index: number): string {
    const id = `${source}#${index}`;
    const cond = attr(el, "cond")?.value;
    const node: TransitionNode = {
      id,
      source,
      index,
      events: splitWs(attr(el, "event")?.value),
      ...(cond !== undefined ? { cond } : {}),
      targets: splitWs(attr(el, "target")?.value),
      type: attr(el, "type")?.value === "internal" ? "internal" : "external",
      actions: this.content(el),
      span: { start: el.start, end: el.end },
    };
    this.transitions.set(id, node);
    this.transitionEls.set(id, el);
    const route = attrNs(el, VL_NS, "route")?.value;
    const label = attrNs(el, VL_NS, "label")?.value;
    const r = route !== undefined ? parseRoute(route) : undefined;
    const l = label !== undefined ? parsePoint(label) : undefined;
    if (r || l) this.tLayout.set(id, { ...(r ? { route: r } : {}), ...(l ? { label: l } : {}) });
    return id;
  }

  private datamodel(el: XElement, owner: string | null): void {
    for (const d of elementChildren(el)) {
      if (!isSc(this, d, "data")) continue;
      const id = attr(d, "id")?.value ?? "";
      const expr = attr(d, "expr")?.value;
      this.data.push({ id, ...(expr !== undefined ? { expr } : {}), owner, span: { start: d.start, end: d.end } });
      if (!this.dataEls.has(id)) this.dataEls.set(id, d);
    }
  }

  /** Executable content children of an element. */
  content(el: XElement): ContentItem[] {
    return contentOf(this, this.text, el.children);
  }
}

const MODELED_ATTRS: Record<string, readonly string[]> = {
  assign: ["location", "expr"],
  raise: ["event"],
  send: ["event", "eventexpr", "target", "type", "delay", "id"],
  log: ["label", "expr"],
  cancel: ["sendid", "sendidexpr"],
  if: ["cond"],
  foreach: ["array", "item", "index"],
};

function opaque(text: string, n: XNode, label: string): ContentItem {
  return { kind: "opaque", label, source: text.slice(n.start, n.end), span: { start: n.start, end: n.end } };
}

/** Executable content of a node list; anything not modeled becomes `opaque`. */
export function contentOf(p: { scNs: string | null }, text: string, nodes: readonly XNode[]): ContentItem[] {
  const out: ContentItem[] = [];
  for (const n of nodes) {
    if (n.kind === "text") {
      if (/\S/.test(n.raw)) out.push(opaque(text, n, "text"));
      continue;
    }
    if (n.kind !== "element") {
      out.push(opaque(text, n, n.kind));
      continue;
    }
    out.push(item(p, text, n));
  }
  return out;
}

function item(p: { scNs: string | null }, text: string, el: XElement): ContentItem {
  const allowed = MODELED_ATTRS[el.local];
  if (!isSc(p, el) || !allowed) return opaque(text, el, el.name);
  if (el.attrs.some((a) => a.ns !== null || a.prefix !== null || !allowed.includes(a.name))) return opaque(text, el, el.name);
  const a = (k: string) => attr(el, k)?.value;
  const span = { start: el.start, end: el.end };
  const kids = el.children.filter((c) => !(c.kind === "text" && !/\S/.test(c.raw)));
  const leaf = kids.length === 0;
  switch (el.local) {
    case "assign": {
      const location = a("location");
      const expr = a("expr");
      if (location === undefined || expr === undefined || !leaf) return opaque(text, el, el.name);
      return { kind: "assign", location, expr, span };
    }
    case "raise": {
      const event = a("event");
      if (event === undefined || !leaf) return opaque(text, el, el.name);
      return { kind: "raise", event, span };
    }
    case "log":
      if (!leaf) return opaque(text, el, el.name);
      return { kind: "log", ...opt("label", a("label")), ...opt("expr", a("expr")), span };
    case "cancel":
      if (!leaf) return opaque(text, el, el.name);
      return { kind: "cancel", ...opt("sendid", a("sendid")), ...opt("sendidexpr", a("sendidexpr")), span };
    case "send": {
      const params: { name: string; expr: string }[] = [];
      for (const k of kids) {
        if (k.kind !== "element" || !isSc(p, k, "param")) return opaque(text, el, el.name);
        const name = attr(k, "name")?.value;
        const expr = attr(k, "expr")?.value;
        if (name === undefined || expr === undefined || k.attrs.length !== 2 || k.children.some((c) => c.kind !== "text" || /\S/.test(c.raw))) {
          return opaque(text, el, el.name);
        }
        params.push({ name, expr });
      }
      return {
        kind: "send",
        ...opt("event", a("event")),
        ...opt("eventexpr", a("eventexpr")),
        ...opt("target", a("target")),
        ...opt("type", a("type")),
        ...opt("delay", a("delay")),
        ...opt("sendid", a("id")),
        ...(params.length > 0 ? { params } : {}),
        span,
      };
    }
    case "if": {
      const cond = a("cond");
      if (cond === undefined) return opaque(text, el, el.name);
      const branches: { cond?: string; actions: ContentItem[] }[] = [];
      let cur: { cond?: string; nodes: XNode[] } = { cond, nodes: [] };
      const flush = () => branches.push({ ...opt("cond", cur.cond), actions: contentOf(p, text, cur.nodes) });
      for (const c of el.children) {
        if (c.kind === "element" && isSc(p, c) && (c.local === "elseif" || c.local === "else")) {
          const okAttrs = c.local === "elseif" ? ["cond"] : [];
          const bad = c.attrs.some((x) => !okAttrs.includes(x.name) || x.ns !== null) || c.children.some((x) => x.kind !== "text" || /\S/.test(x.raw));
          const bc = attr(c, "cond")?.value;
          // A malformed marker, or anything after <else/>, keeps the whole <if> opaque.
          if (bad || (c.local === "elseif" && bc === undefined) || cur.cond === undefined) return opaque(text, el, el.name);
          flush();
          cur = { ...(c.local === "elseif" ? { cond: bc! } : {}), nodes: [] };
        } else cur.nodes.push(c);
      }
      flush();
      return { kind: "if", branches, span };
    }
    case "foreach": {
      const array = a("array");
      const it = a("item");
      if (array === undefined || it === undefined) return opaque(text, el, el.name);
      return { kind: "foreach", array, item: it, ...opt("index", a("index")), actions: contentOf(p, text, el.children), span };
    }
  }
  return opaque(text, el, el.name);
}

function opt<K extends string>(k: K, v: string | undefined): { [P in K]?: string } {
  return (v === undefined ? {} : { [k]: v }) as { [P in K]?: string };
}
