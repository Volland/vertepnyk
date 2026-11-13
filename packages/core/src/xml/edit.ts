/**
 * Edit commands on SCXML text: each command becomes minimal patches on the lossless tree.
 * Only the attributes and elements a command concerns change; new markup follows the
 * indentation of its siblings.
 */
import {
  EditError,
  type Command,
  type ContentItem,
  type ContentOwner,
  type StateLayout,
  type TextPatch,
  type TransitionLayout,
} from "../model.js";
import { VL_NS, type Backend, type EditSession } from "../backend.js";
import { commonEnds, sameItem } from "../content.js";
import { checkDataOwner, checkInitial, checkNewId, checkRemovable, idBase, requireState, subtree, uniqueId } from "../ids.js";
import { columnOf, firstOnLine, indentAt, lastOnLine, lineEnd, lineStart, reindent } from "../text.js";
import { allElements, attr, attrNs, elementChildren, escapeAttr, type XElement, type XNode } from "./cst.js";
import { isSc, isStateEl, parseScxml, type XmlParsed } from "./semantic.js";

type Session = EditSession<XmlParsed>;

// ------------------------------------------------------------------------------ helpers

/** The indentation unit used by the document (most common parent→child indent step). */
function detectUnit(p: XmlParsed): string {
  const t = p.text;
  const counts = new Map<string, number>();
  for (const el of allElements(p.doc.root)) {
    if (!el.parent || !firstOnLine(t, el.start) || !firstOnLine(t, el.parent.start)) continue;
    const ci = indentAt(t, el.start);
    const pi = indentAt(t, el.parent.start);
    if (ci.length > pi.length && ci.startsWith(pi)) {
      const u = ci.slice(pi.length);
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
  }
  let best = "  ";
  let n = 0;
  for (const [u, c] of counts) if (c > n) [best, n] = [u, c];
  return best;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function pfx(p: XmlParsed): string {
  return p.doc.root.prefix ? `${p.doc.root.prefix}:` : "";
}

function significant(el: XElement): XNode[] {
  return el.children.filter((c) => !(c.kind === "text" && !/\S/.test(c.raw)));
}

function sameLine(t: string, a: number, b: number): boolean {
  return !t.slice(a, b).includes("\n");
}

function tokens(raw: string): { tok: string; at: number }[] {
  const out: { tok: string; at: number }[] = [];
  for (const m of raw.matchAll(/\S+/g)) out.push({ tok: m[0], at: m.index });
  return out;
}

type AttrKey = string | { ns: string; local: string; qname: string };

/** Set (string) or remove (null) attributes of one element. New attributes are appended. */
function setAttrs(el: XElement, changes: readonly [AttrKey, string | null][]): TextPatch[] {
  const out: TextPatch[] = [];
  let insert = "";
  for (const [key, value] of changes) {
    const a = typeof key === "string" ? attr(el, key) : attrNs(el, key.ns, key.local);
    const qname = typeof key === "string" ? key : key.qname;
    if (a) {
      if (value === null) {
        const next = el.attrs[el.attrs.indexOf(a) + 1];
        // An attribute that starts a line takes the following spaces instead of its line break.
        if (a.before.includes("\n") && next && !next.before.includes("\n")) out.push({ start: a.start, end: next.start, text: "" });
        else out.push({ start: a.start - a.before.length, end: a.end, text: "" });
      }
      else if (a.value !== value) out.push({ start: a.valueStart, end: a.valueEnd, text: escapeAttr(value, a.quote) });
    } else if (value !== null) {
      insert += ` ${qname}="${escapeAttr(value)}"`;
    }
  }
  if (insert) {
    const last = el.attrs[el.attrs.length - 1];
    const at = last ? last.end : el.nameEnd;
    out.push({ start: at, end: at, text: insert });
  }
  // Removals of neighbouring attributes may overlap in the whitespace between them: merge them.
  out.sort((x, y) => x.start - y.start || x.end - y.end);
  const merged: TextPatch[] = [];
  for (const p of out) {
    const prev = merged[merged.length - 1];
    if (prev && p.start < prev.end && prev.text === "" && p.text === "") merged[merged.length - 1] = { start: prev.start, end: Math.max(prev.end, p.end), text: "" };
    else merged.push(p);
  }
  return merged;
}

type Where = { before: XNode } | { after: XNode } | "end";

/** Insert markup (rendered for an indentation) as a child of `parent`. */
function insertChild(s: Session, parent: XElement, where: Where, render: (ind: string) => string, blankLine = false): TextPatch {
  const t = s.text;
  const unit = detectUnit(s.parsed);
  const pInd = indentAt(t, parent.start);
  if (parent.selfClosing) {
    const ci = pInd + unit;
    const from = parent.startTagEnd - 2 - parent.tagTrail.length;
    return { start: from, end: parent.startTagEnd, text: `>\n${ci}${render(ci)}\n${pInd}</${parent.name}>` };
  }
  if (where === "end") {
    const kids = significant(parent);
    const last = kids[kids.length - 1];
    if (!last) {
      const ci = pInd + unit;
      if (sameLine(t, parent.startTagEnd, parent.endTagStart) || !firstOnLine(t, parent.endTagStart)) {
        return { start: parent.startTagEnd, end: parent.endTagStart, text: `\n${ci}${render(ci)}\n${pInd}` };
      }
      const at = lineStart(t, parent.endTagStart);
      return { start: at, end: at, text: `${ci}${render(ci)}\n` };
    }
    where = { after: last };
  }
  if ("after" in where) {
    const x = where.after;
    if (!firstOnLine(t, x.start) && sameLine(t, parent.startTagEnd, x.end)) {
      return { start: x.end, end: x.end, text: render(indentAt(t, x.start)) };
    }
    const ind = firstOnLine(t, x.start) ? indentAt(t, x.start) : pInd + unit;
    let at = x.end;
    const rest = t.slice(x.end, lineEnd(t, x.end));
    if (/^\s*<!--.*-->\s*$/.test(rest)) at = lineEnd(t, x.end);
    return { start: at, end: at, text: `${blankLine ? "\n" : ""}\n${ind}${render(ind)}` };
  }
  const x = where.before;
  if (firstOnLine(t, x.start)) {
    const ind = indentAt(t, x.start);
    const at = lineStart(t, x.start);
    return { start: at, end: at, text: `${ind}${render(ind)}\n${blankLine ? "\n" : ""}` };
  }
  return { start: x.start, end: x.start, text: render(indentAt(t, x.start)) };
}

/** Patch removing one node, taking whole lines when the node is alone on them. */
function removeOne(t: string, n: XNode): TextPatch {
  if (firstOnLine(t, n.start) && lastOnLine(t, n.end)) {
    const e = lineEnd(t, n.end);
    return { start: lineStart(t, n.start), end: e < t.length ? e + 1 : e, text: "" };
  }
  if (lastOnLine(t, n.end)) {
    let s = n.start;
    while (s > 0 && (t[s - 1] === " " || t[s - 1] === "\t")) s--;
    return { start: s, end: n.end, text: "" };
  }
  return { start: n.start, end: n.end, text: "" };
}

/**
 * Remove nodes. When every significant child of a parent goes, a state or transition parent
 * collapses to a self-closing tag and a `datamodel`/`onentry`/`onexit`/`initial` parent is
 * removed itself.
 */
function removeNodes(p: XmlParsed, nodes: readonly XNode[]): TextPatch[] {
  const t = p.text;
  const set = new Set(nodes);
  const isInside = (n: XNode) => {
    for (let a = n.parent; a; a = a.parent) if (set.has(a)) return true;
    return false;
  };
  const top = nodes.filter((n) => !isInside(n));
  const byParent = new Map<XElement | null, XNode[]>();
  for (const n of top) byParent.set(n.parent, [...(byParent.get(n.parent) ?? []), n]);
  const out: TextPatch[] = [];
  for (const [parent, kids] of byParent) {
    if (parent && parent !== p.doc.root && significant(parent).every((k) => kids.includes(k))) {
      if (isStateEl(p, parent) || isSc(p, parent, "transition")) {
        out.push({ start: parent.startTagEnd - 1, end: parent.end, text: "/>" });
        continue;
      }
      if (isSc(p, parent) && ["datamodel", "onentry", "onexit", "initial"].includes(parent.local)) {
        out.push(...removeNodes(p, [parent]));
        continue;
      }
    }
    for (const k of kids) out.push(removeOne(t, k));
  }
  return out;
}

function stateEl(p: XmlParsed, id: string | null): XElement {
  if (id === null) return p.doc.root;
  const el = p.stateEls.get(id);
  if (!el) throw new EditError("UnknownId", `no state \`${id}\``);
  return el;
}

function stateKids(p: XmlParsed, el: XElement): XElement[] {
  return elementChildren(el).filter((c) => isStateEl(p, c));
}

/** All `<transition>` elements of the document, including `<initial>` and history defaults. */
function allTransitions(p: XmlParsed): XElement[] {
  return [...allElements(p.doc.root)].filter((e) => isSc(p, e, "transition"));
}

function checkTargets(p: XmlParsed, targets: readonly string[]): void {
  for (const t of targets) requireState(p.model, t);
}

function checkEvents(events: readonly string[]): void {
  for (const e of events) if (!e || /\s/.test(e)) throw new EditError("InvalidId", `\`${e}\` is not an event descriptor`);
}

// ------------------------------------------------------------------------------ rendering

function attrsText(pairs: readonly [string, string | undefined][]): string {
  return pairs
    .filter((x): x is [string, string] => x[1] !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
}

type Reuse = (item: ContentItem, ind: string) => string | undefined;

function renderItems(p: XmlParsed, items: readonly ContentItem[], ind: string, unit: string, reuse: Reuse): string {
  return items.map((i) => `\n${ind}${renderItem(p, i, ind, unit, reuse)}`).join("");
}

function renderItem(p: XmlParsed, item: ContentItem, ind: string, unit: string, reuse: Reuse): string {
  const r = reuse(item, ind);
  if (r !== undefined) return r;
  const x = pfx(p);
  const inner = ind + unit;
  switch (item.kind) {
    case "assign":
      return `<${x}assign${attrsText([["location", item.location], ["expr", item.expr]])}/>`;
    case "raise":
      return `<${x}raise${attrsText([["event", item.event]])}/>`;
    case "log":
      return `<${x}log${attrsText([["label", item.label], ["expr", item.expr]])}/>`;
    case "cancel":
      return `<${x}cancel${attrsText([["sendid", item.sendid], ["sendidexpr", item.sendidexpr]])}/>`;
    case "send": {
      const a = attrsText([
        ["id", item.sendid],
        ["event", item.event],
        ["eventexpr", item.eventexpr],
        ["target", item.target],
        ["type", item.type],
        ["delay", item.delay],
      ]);
      const params = item.params ?? [];
      if (params.length === 0) return `<${x}send${a}/>`;
      const ps = params.map((q) => `\n${inner}<${x}param${attrsText([["name", q.name], ["expr", q.expr]])}/>`).join("");
      return `<${x}send${a}>${ps}\n${ind}</${x}send>`;
    }
    case "if": {
      let out = "";
      item.branches.forEach((b, i) => {
        if (i === 0) out += `<${x}if${attrsText([["cond", b.cond ?? "true"]])}>`;
        else if (b.cond !== undefined) out += `\n${ind}<${x}elseif${attrsText([["cond", b.cond]])}/>`;
        else out += `\n${ind}<${x}else/>`;
        out += renderItems(p, b.actions, inner, unit, reuse);
      });
      if (item.branches.length === 0) out = `<${x}if cond="true">`;
      return `${out}\n${ind}</${x}if>`;
    }
    case "foreach": {
      const a = attrsText([["array", item.array], ["item", item.item], ["index", item.index]]);
      if (item.actions.length === 0) return `<${x}foreach${a}/>`;
      return `<${x}foreach${a}>${renderItems(p, item.actions, inner, unit, reuse)}\n${ind}</${x}foreach>`;
    }
    case "opaque":
      return item.span ? reindent(item.source, columnOf(p.text, item.span.start), ind.length) : item.source;
  }
}

/** Reuse the original text of items that are unchanged and still present in the document. */
function reuser(p: XmlParsed, old: readonly ContentItem[]): Reuse {
  const byStart = new Map<number, ContentItem>();
  const walk = (items: readonly ContentItem[]) => {
    for (const i of items) {
      if (i.span) byStart.set(i.span.start, i);
      if (i.kind === "if") for (const b of i.branches) walk(b.actions);
      if (i.kind === "foreach") walk(i.actions);
    }
  };
  walk(old);
  return (item, ind) => {
    if (!item.span) return undefined;
    const o = byStart.get(item.span.start);
    if (!o || !o.span || o.span.end !== item.span.end || !sameItem(o, item)) return undefined;
    return reindent(p.text.slice(o.span.start, o.span.end), columnOf(p.text, o.span.start), ind.length);
  };
}

/**
 * Replace the executable content of `el` (an `onentry`/`onexit`/`transition`), changing only
 * the items between the unchanged prefix and suffix.
 */
function contentPatch(s: Session, el: XElement, old: readonly ContentItem[], items: readonly ContentItem[]): TextPatch[] {
  const p = s.parsed;
  const t = p.text;
  const unit = detectUnit(p);
  const ind = indentAt(t, el.start);
  const reuse = reuser(p, old);
  const [k, m] = commonEnds(old, items);
  if (k === old.length && k === items.length) return [];
  if (el.selfClosing) {
    const rendered = items.map((i) => renderItem(p, i, ind + unit, unit, reuse));
    const inline = rendered.length === 1 && !rendered[0]!.includes("\n") && rendered[0]!.length < 80;
    const body = inline ? rendered[0]! : rendered.map((r) => `\n${ind}${unit}${r}`).join("") + `\n${ind}`;
    const from = el.startTagEnd - 2 - el.tagTrail.length;
    return [{ start: from, end: el.startTagEnd, text: `>${body}</${el.name}>` }];
  }
  if (items.length === 0) return [{ start: el.startTagEnd - 1, end: el.end, text: "/>" }];
  const inline = sameLine(t, el.start, el.end);
  const first = old[0];
  const itemInd = first?.span && firstOnLine(t, first.span.start) ? indentAt(t, first.span.start) : ind + unit;
  const mid = items.slice(k, items.length - m).map((i) => renderItem(p, i, itemInd, unit, reuse));
  const multiline = mid.some((r) => r.includes("\n"));
  if (inline && !multiline) {
    const start = k > 0 ? old[k - 1]!.span!.end : el.startTagEnd;
    const end = m > 0 ? old[old.length - m]!.span!.start : el.endTagStart;
    return [{ start, end, text: mid.join("") }];
  }
  const sep = `\n${itemInd}`;
  if (inline || (k === 0 && m === 0)) {
    // Re-lay the whole content out one item per line.
    const all = items.map((i, n) => (n >= k && n < items.length - m ? mid[n - k]! : renderItem(p, i, itemInd, unit, reuse)));
    return [{ start: el.startTagEnd, end: el.endTagStart, text: all.map((r) => sep + r).join("") + `\n${ind}` }];
  }
  if (k > 0 && m > 0) {
    return [{ start: old[k - 1]!.span!.end, end: old[old.length - m]!.span!.start, text: mid.map((r) => sep + r).join("") + sep }];
  }
  if (k > 0) {
    return [{ start: old[k - 1]!.span!.end, end: old[old.length - 1]!.span!.end, text: mid.map((r) => sep + r).join("") }];
  }
  return [{ start: old[0]!.span!.start, end: old[old.length - m]!.span!.start, text: mid.map((r) => r + sep).join("") }];
}

// ------------------------------------------------------------------------------ layout

function vlPrefix(p: XmlParsed): { prefix: string; declare: boolean } {
  const root = p.doc.root;
  const decl = root.attrs.find((a) => a.prefix === "xmlns" && a.value === VL_NS);
  if (decl) return { prefix: decl.local, declare: false };
  let prefix = "vl";
  for (let n = 2; root.attrs.some((a) => a.prefix === "xmlns" && a.local === prefix); n++) prefix = `vl${n}`;
  return { prefix, declare: true };
}

function vl(prefix: string, local: string): AttrKey {
  return { ns: VL_NS, local, qname: `${prefix}:${local}` };
}

function stateLayoutAttrs(prefix: string, l: StateLayout | null): [AttrKey, string | null][] {
  return [
    [vl(prefix, "x"), l ? fmt(l.x) : null],
    [vl(prefix, "y"), l ? fmt(l.y) : null],
    [vl(prefix, "w"), l ? fmt(l.w) : null],
    [vl(prefix, "h"), l ? fmt(l.h) : null],
    [vl(prefix, "collapsed"), l?.collapsed ? "true" : null],
  ];
}

function transitionLayoutAttrs(prefix: string, l: TransitionLayout | null): [AttrKey, string | null][] {
  return [
    [vl(prefix, "route"), l?.route && l.route.length > 0 ? l.route.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ") : null],
    [vl(prefix, "label"), l?.label ? `${fmt(l.label[0])},${fmt(l.label[1])}` : null],
  ];
}

// ------------------------------------------------------------------------------ commands

function addState(s: Session, cmd: Extract<Command, { type: "addState" }>): void {
  const p = s.parsed;
  const parentEl = stateEl(p, cmd.parent);
  if (cmd.parent !== null) {
    const k = p.model.states.get(cmd.parent)!.kind;
    if (k === "history" || k === "final") throw new EditError("Unsupported", `a ${k} state cannot have children`);
  }
  if (cmd.kind === "history" && cmd.parent === null) throw new EditError("Unsupported", "a history state needs a parent");
  const id = cmd.id ?? uniqueId(p.model, idBase(cmd.kind));
  checkNewId(p.model, id);
  const tag = cmd.kind === "atomic" || cmd.kind === "compound" ? "state" : cmd.kind;
  const lp = vlPrefix(p);
  const layout = cmd.layout
    ? stateLayoutAttrs(lp.prefix, cmd.layout)
        .filter((x) => x[1] !== null)
        .map(([k, v]) => ` ${(k as { qname: string }).qname}="${v}"`)
        .join("")
    : "";
  const hist = cmd.kind === "history" && cmd.historyType === "deep" ? ` type="deep"` : "";
  const markup = `<${pfx(p)}${tag} id="${escapeAttr(id)}"${hist}${layout}/>`;
  const sibs = stateKids(p, parentEl);
  const last = sibs[sibs.length - 1];
  const prev = sibs[sibs.length - 2];
  const blank = !!(last && prev && /\n[ \t]*\r?\n/.test(p.text.slice(prev.end, last.start)));
  const patches = [insertChild(s, parentEl, last ? { after: last } : "end", () => markup, blank)];
  if (cmd.layout && lp.declare) patches.push(...setAttrs(p.doc.root, [[`xmlns:${lp.prefix}`, VL_NS]]));
  s.commit(patches);
}

/** Drop references to `gone` ids from targets and `initial` attributes outside `gone`. */
function dropReferences(p: XmlParsed, gone: ReadonlySet<string>, keepInside: ReadonlySet<string>): TextPatch[] {
  const patches: TextPatch[] = [];
  const removals: XNode[] = [];
  const keptEls = new Set([...keepInside].map((id) => p.stateEls.get(id)));
  const insideKept = (el: XElement) => {
    for (let a: XElement | null = el; a; a = a.parent) if (keptEls.has(a)) return true;
    return false;
  };
  for (const tr of allTransitions(p)) {
    if (insideKept(tr)) continue;
    const ta = attr(tr, "target");
    if (!ta) continue;
    const toks = tokens(ta.value);
    const remaining = toks.filter((x) => !gone.has(x.tok)).map((x) => x.tok);
    if (remaining.length === toks.length) continue;
    if (remaining.length > 0) patches.push(...setAttrs(tr, [["target", remaining.join(" ")]]));
    else if (tr.parent && isSc(p, tr.parent, "initial")) removals.push(tr.parent);
    else removals.push(tr);
  }
  const holders = [p.doc.root, ...p.stateEls.values()];
  for (const el of holders) {
    if (el !== p.doc.root && insideKept(el)) continue;
    const ia = attr(el, "initial");
    if (!ia) continue;
    const toks = tokens(ia.value);
    const remaining = toks.filter((x) => !gone.has(x.tok)).map((x) => x.tok);
    if (remaining.length !== toks.length) patches.push(...setAttrs(el, [["initial", remaining.length ? remaining.join(" ") : null]]));
  }
  return [...patches, ...removeNodes(p, removals)];
}

function removeState(s: Session, id: string): void {
  checkRemovable(s.model, id);
  const gone = subtree(s.model, id);
  s.commit(dropReferences(s.parsed, gone, gone));
  s.commit(removeNodes(s.parsed, [stateEl(s.parsed, id)]));
}

function renameState(s: Session, id: string, newId: string): void {
  const p = s.parsed;
  requireState(p.model, id);
  if (id === newId) return;
  checkNewId(p.model, newId);
  const patches: TextPatch[] = [...setAttrs(stateEl(p, id), [["id", newId]])];
  const retarget = (el: XElement, name: string) => {
    const a = attr(el, name);
    if (!a) return;
    for (const { tok, at } of tokens(a.raw)) {
      if (tok === id) patches.push({ start: a.valueStart + at, end: a.valueStart + at + tok.length, text: newId });
    }
  };
  for (const tr of allTransitions(p)) retarget(tr, "target");
  retarget(p.doc.root, "initial");
  for (const el of p.stateEls.values()) retarget(el, "initial");
  s.commit(patches);
}

function moveElement(s: Session, el: XElement, place: (p: XmlParsed) => { parent: XElement; where: Where }, extra: TextPatch[] = []): void {
  const t = s.text;
  const markup = t.slice(el.start, el.end);
  const col = columnOf(t, el.start);
  s.commit([...extra, ...removeNodes(s.parsed, [el])]);
  const { parent, where } = place(s.parsed);
  s.commit([insertChild(s, parent, where, (ind) => reindent(markup, col, ind.length))]);
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
  // `initial` references to the moved states from ancestors they leave.
  const newAnc = new Set<string>();
  for (let a = cmd.parent; a !== null; a = p.model.states.get(a)?.parent ?? null) newAnc.add(a);
  const extra: TextPatch[] = [];
  for (let a = p.model.states.get(cmd.id)!.parent; a !== null; a = p.model.states.get(a)?.parent ?? null) {
    if (newAnc.has(a)) continue;
    const el = stateEl(p, a);
    const ia = attr(el, "initial");
    if (ia) {
      const toks = tokens(ia.value).map((x) => x.tok);
      const rest = toks.filter((x) => !moved.has(x));
      if (rest.length !== toks.length) extra.push(...setAttrs(el, [["initial", rest.length ? rest.join(" ") : null]]));
    }
  }
  const id = cmd.id;
  moveElement(
    s,
    stateEl(p, id),
    (q) => {
      const parent = stateEl(q, cmd.parent);
      const sibs = stateKids(q, parent);
      if (cmd.index !== undefined && cmd.index < sibs.length) return { parent, where: { before: sibs[Math.max(0, cmd.index)]! } };
      const last = sibs[sibs.length - 1];
      return { parent, where: last ? { after: last } : "end" };
    },
    extra,
  );
}

function setStateKind(s: Session, cmd: Extract<Command, { type: "setStateKind" }>): void {
  const p = s.parsed;
  requireState(p.model, cmd.id);
  const st = p.model.states.get(cmd.id)!;
  const el = stateEl(p, cmd.id);
  const k = cmd.kind;
  if (k === "compound" && st.children.length === 0) throw new EditError("Unsupported", "add a child state to make a compound state");
  if (k === "atomic" && st.children.length > 0) throw new EditError("Unsupported", "remove the child states to make an atomic state");
  if ((k === "final" || k === "history") && st.children.length > 0) throw new EditError("Unsupported", `a ${k} state cannot have children`);
  if (k === "history" && st.parent === null) throw new EditError("Unsupported", "a history state needs a parent");
  if (k === "final" && st.transitions.length > 0) throw new EditError("Unsupported", "a final state cannot have transitions");
  if ((k === "final" || k === "history") && p.model.data.some((d) => d.owner === cmd.id)) throw new EditError("Unsupported", `a ${k} state has no datamodel`);
  const tag = k === "atomic" || k === "compound" ? "state" : k;
  const patches: TextPatch[] = [];
  if (el.local !== tag) {
    const name = pfx(p) + tag;
    patches.push({ start: el.start + 1, end: el.nameEnd, text: name });
    if (!el.selfClosing) patches.push({ start: el.endTagStart + 2, end: el.endTagStart + 2 + el.name.length, text: name });
  }
  const changes: [AttrKey, string | null][] = [];
  if (k === "history") {
    if (cmd.historyType === "deep") changes.push(["type", "deep"]);
    else if (attr(el, "type")) changes.push(["type", cmd.historyType === "shallow" ? "shallow" : attr(el, "type")!.value]);
  } else if (st.kind === "history") changes.push(["type", null]);
  if (k === "parallel" || k === "final" || k === "history") changes.push(["initial", null]);
  patches.push(...setAttrs(el, changes));
  s.commit(patches);
}

function setInitial(s: Session, state: string | null, initial: readonly string[]): void {
  const p = s.parsed;
  const el = stateEl(p, state);
  checkInitial(p.model, state, initial);
  const ie = state !== null ? p.initialEls.get(state) : undefined;
  if (ie) {
    const tr = elementChildren(ie).find((c) => isSc(p, c, "transition"));
    if (initial.length === 0) s.commit(removeNodes(p, [ie]));
    else if (tr) s.commit(setAttrs(tr, [["target", initial.join(" ")]]));
    return;
  }
  s.commit(setAttrs(el, [["initial", initial.length ? initial.join(" ") : null]]));
}

function transitionWhere(p: XmlParsed, src: XElement): Where {
  const kids = elementChildren(src);
  const trs = kids.filter((c) => isSc(p, c, "transition"));
  const lastT = trs[trs.length - 1];
  if (lastT) return { after: lastT };
  const firstState = kids.find((c) => isStateEl(p, c) || isSc(p, c, "invoke"));
  return firstState ? { before: firstState } : "end";
}

function addTransition(s: Session, cmd: Extract<Command, { type: "addTransition" }>): void {
  const p = s.parsed;
  requireState(p.model, cmd.source);
  checkTargets(p, cmd.targets);
  checkEvents(cmd.events ?? []);
  if (p.model.states.get(cmd.source)!.kind === "final") throw new EditError("Unsupported", "a final state cannot have transitions");
  const markup = `<${pfx(p)}transition${attrsText([
    ["event", cmd.events?.length ? cmd.events.join(" ") : undefined],
    ["cond", cmd.cond],
    ["target", cmd.targets.length ? cmd.targets.join(" ") : undefined],
    ["type", cmd.transitionType === "internal" ? "internal" : undefined],
  ])}/>`;
  const src = stateEl(p, cmd.source);
  s.commit([insertChild(s, src, transitionWhere(p, src), () => markup)]);
}

function transitionEl(p: XmlParsed, id: string): XElement {
  const el = p.transitionEls.get(id);
  if (!el) throw new EditError("UnknownId", `no transition \`${id}\``);
  return el;
}

function updateTransition(s: Session, cmd: Extract<Command, { type: "updateTransition" }>): void {
  const p = s.parsed;
  const el = transitionEl(p, cmd.id);
  if (cmd.targets) checkTargets(p, cmd.targets);
  if (cmd.events) checkEvents(cmd.events);
  if (cmd.source !== undefined) {
    requireState(p.model, cmd.source);
    if (p.model.states.get(cmd.source)!.kind === "final") throw new EditError("Unsupported", "a final state cannot have transitions");
  }
  const changes: [AttrKey, string | null][] = [];
  if (cmd.events) changes.push(["event", cmd.events.length ? cmd.events.join(" ") : null]);
  if (cmd.cond !== undefined) changes.push(["cond", cmd.cond]);
  if (cmd.targets) changes.push(["target", cmd.targets.length ? cmd.targets.join(" ") : null]);
  if (cmd.transitionType === "internal") changes.push(["type", "internal"]);
  else if (cmd.transitionType === "external" && attr(el, "type")) changes.push(["type", "external"]);
  s.commit(setAttrs(el, changes));
  const t = p.model.transitions.get(cmd.id)!;
  if (cmd.source !== undefined && cmd.source !== t.source) {
    const src = cmd.source;
    moveElement(s, transitionEl(s.parsed, cmd.id), (q) => {
      const parent = stateEl(q, src);
      return { parent, where: transitionWhere(q, parent) };
    });
  }
}

function setContent(s: Session, owner: ContentOwner, items: readonly ContentItem[]): void {
  const p = s.parsed;
  if ("transition" in owner) {
    const el = transitionEl(p, owner.transition);
    s.commit(contentPatch(s, el, p.model.transitions.get(owner.transition)!.actions, items));
    return;
  }
  requireState(p.model, owner.state);
  const st = p.model.states.get(owner.state)!;
  const blocks = p.blockEls.get(owner.state)![owner.slot];
  const modelBlocks = st[owner.slot];
  if (blocks.length === 0) {
    if (items.length === 0) return;
    const parent = stateEl(p, owner.state);
    const kids = elementChildren(parent);
    const x = pfx(p);
    const where: Where = (() => {
      if (owner.slot === "onexit") {
        const entries = kids.filter((c) => isSc(p, c, "onentry"));
        const le = entries[entries.length - 1];
        if (le) return { after: le };
      }
      const next = kids.find(
        (c) => isSc(p, c) && (["transition", "invoke"].includes(c.local) || (owner.slot === "onentry" && c.local === "onexit") || isStateEl(p, c)),
      );
      return next ? { before: next } : "end";
    })();
    const unit = detectUnit(p);
    const reuse = reuser(p, []);
    s.commit([
      insertChild(s, parent, where, (ind) => {
        const rendered = items.map((i) => renderItem(p, i, ind + unit, unit, reuse));
        if (rendered.length === 1 && !rendered[0]!.includes("\n") && rendered[0]!.length < 80) {
          return `<${x}${owner.slot}>${rendered[0]}</${x}${owner.slot}>`;
        }
        return `<${x}${owner.slot}>${rendered.map((r) => `\n${ind}${unit}${r}`).join("")}\n${ind}</${x}${owner.slot}>`;
      }),
    ]);
    return;
  }
  if (blocks.length > 1) {
    // Fold every block into the first: drop the others, then rewrite the first.
    s.commit(removeNodes(p, blocks.slice(1)));
    const q = s.parsed;
    const first = q.blockEls.get(owner.state)![owner.slot][0]!;
    const old = q.model.states.get(owner.state)![owner.slot][0]!.items;
    s.commit(items.length === 0 ? removeNodes(q, [first]) : contentPatch(s, first, old, items));
    return;
  }
  const first = blocks[0]!;
  if (items.length === 0) s.commit(removeNodes(p, [first]));
  else s.commit(contentPatch(s, first, modelBlocks[0]!.items, items));
}

function dataEl(p: XmlParsed, id: string): XElement {
  const el = p.dataEls.get(id);
  if (!el) throw new EditError("UnknownId", `no data item \`${id}\``);
  return el;
}

function addData(s: Session, cmd: Extract<Command, { type: "addData" }>): void {
  const p = s.parsed;
  if (cmd.dataType !== undefined) throw new EditError("Unsupported", "SCXML data items have no declared type");
  const owner = stateEl(p, cmd.owner);
  checkDataOwner(p.model, cmd.owner);
  checkNewId(p.model, cmd.id);
  const x = pfx(p);
  const data = `<${x}data${attrsText([["id", cmd.id], ["expr", cmd.expr]])}/>`;
  const dm = elementChildren(owner).find((c) => isSc(p, c, "datamodel"));
  if (dm) {
    const ds = elementChildren(dm).filter((c) => isSc(p, c, "data"));
    const last = ds[ds.length - 1];
    s.commit([insertChild(s, dm, last ? { after: last } : "end", () => data)]);
    return;
  }
  const unit = detectUnit(p);
  const firstKid = elementChildren(owner)[0];
  s.commit([
    insertChild(s, owner, firstKid ? { before: firstKid } : "end", (ind) => `<${x}datamodel>\n${ind}${unit}${data}\n${ind}</${x}datamodel>`),
  ]);
}

function updateData(s: Session, cmd: Extract<Command, { type: "updateData" }>): void {
  const p = s.parsed;
  const el = dataEl(p, cmd.id);
  if (cmd.dataType !== undefined && cmd.dataType !== null) throw new EditError("Unsupported", "SCXML data items have no declared type");
  const changes: [AttrKey, string | null][] = [];
  if (cmd.newId !== undefined && cmd.newId !== cmd.id) {
    checkNewId(p.model, cmd.newId);
    changes.push(["id", cmd.newId]);
  }
  if (cmd.expr !== undefined) changes.push(["expr", cmd.expr]);
  s.commit(setAttrs(el, changes));
}

// @tg: implements:: [[openspec:chart-layout#Layout never changes the chart hash]] {note: "layout is written only as vl: attributes, which vertep treats as formatting"}
function setLayout(s: Session, cmd: Extract<Command, { type: "setLayout" }>): void {
  const p = s.parsed;
  const lp = vlPrefix(p);
  const patches: TextPatch[] = [];
  let wrote = false;
  for (const [id, l] of Object.entries(cmd.states ?? {})) {
    const el = stateEl(p, id);
    patches.push(...setAttrs(el, stateLayoutAttrs(lp.prefix, l)));
    wrote ||= l !== null;
  }
  for (const [id, l] of Object.entries(cmd.transitions ?? {})) {
    const el = transitionEl(p, id);
    patches.push(...setAttrs(el, transitionLayoutAttrs(lp.prefix, l)));
    wrote ||= l !== null;
  }
  if (wrote && lp.declare) patches.push(...setAttrs(p.doc.root, [[`xmlns:${lp.prefix}`, VL_NS]]));
  s.commit(patches);
}

// @tg: implements:: [[openspec:chart-document#Format-preserving edits]]
// @tg: implements:: [[openspec:chart-document#Rename updates references]]
// @tg: implements:: [[openspec:chart-document#Unmodeled content is preserved]]
// @tg: implements:: [[openspec:chart-layout#Layout is stored inline]]
/** The SCXML format: lossless XML tree, semantic view and command patches. */
export const scxmlBackend: Backend<XmlParsed> = {
  format: "scxml",
  parse: parseScxml,
  apply(s, cmd) {
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
        return s.commit(removeNodes(s.parsed, [transitionEl(s.parsed, cmd.id)]));
      case "updateTransition":
        return updateTransition(s, cmd);
      case "setContent":
        return setContent(s, cmd.owner, cmd.items);
      case "addData":
        return addData(s, cmd);
      case "updateData":
        return updateData(s, cmd);
      case "removeData":
        return s.commit(removeNodes(s.parsed, [dataEl(s.parsed, cmd.id)]));
      case "setLayout":
        return setLayout(s, cmd);
      case "setChartProps": {
        const ch: [AttrKey, string | null][] = [];
        if (cmd.name !== undefined) ch.push(["name", cmd.name]);
        if (cmd.datamodel !== undefined) ch.push(["datamodel", cmd.datamodel]);
        return s.commit(setAttrs(s.parsed.doc.root, ch));
      }
    }
  },
};
