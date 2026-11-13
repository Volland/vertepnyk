/**
 * A lossless concrete syntax tree for XML (SCXML): every element, attribute, text run, comment,
 * CDATA section, processing instruction and doctype keeps its exact source offsets and the raw
 * whitespace between tokens, so `printXml(parseXml(x)) === x` for every well-formed document.
 *
 * Hand-written, no dependency. Namespaces are resolved after parsing.
 */
import { ChartParseFailure } from "../errors.js";
import { positionAt } from "../text.js";

export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

export interface XAttr {
  /** Qualified name as written. */
  readonly name: string;
  readonly prefix: string | null;
  readonly local: string;
  /** Resolved namespace (null for unprefixed attributes). */
  ns: string | null;
  /** Raw whitespace before the name. */
  readonly before: string;
  /** Raw text between the name and the opening quote (`=` with optional spaces). */
  readonly eq: string;
  readonly quote: '"' | "'";
  /** Raw value between the quotes and its decoded form. */
  readonly raw: string;
  readonly value: string;
  /** Offset of the name (= start of the attribute). */
  readonly start: number;
  readonly nameEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  /** Offset after the closing quote. */
  readonly end: number;
}

interface XBase {
  readonly start: number;
  end: number;
  parent: XElement | null;
}

export interface XElement extends XBase {
  readonly kind: "element";
  readonly name: string;
  readonly prefix: string | null;
  readonly local: string;
  ns: string | null;
  readonly nameEnd: number;
  readonly attrs: XAttr[];
  /** Raw whitespace between the last attribute (or the name) and `>` / `/>`. */
  tagTrail: string;
  selfClosing: boolean;
  /** Offset after the start tag's `>`. */
  startTagEnd: number;
  readonly children: XNode[];
  /** Offset of `</` of the end tag; equals `end` for self-closing elements. */
  endTagStart: number;
  /** Raw whitespace between the end tag's name and `>`. */
  endTrail: string;
}

export interface XText extends XBase {
  readonly kind: "text";
  readonly raw: string;
  readonly value: string;
}

export interface XRaw extends XBase {
  readonly kind: "comment" | "cdata" | "pi" | "doctype";
  readonly raw: string;
}

export type XNode = XElement | XText | XRaw;

export interface XDocument {
  readonly text: string;
  readonly children: XNode[];
  readonly root: XElement;
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

class XmlParser {
  private i = 0;
  private hasDoctype = false;
  constructor(private readonly s: string) {}

  fail(at: number, message: string): never {
    throw new ChartParseFailure(this.s, at, message);
  }

  parse(): XDocument {
    const children: XNode[] = [];
    let root: XElement | null = null;
    while (this.i < this.s.length) {
      const node = this.node(null);
      if (node.kind === "element") {
        if (root) this.fail(node.start, "a document has exactly one root element");
        root = node;
      } else if (node.kind === "text") {
        if (/\S/.test(node.raw)) this.fail(node.start + node.raw.search(/\S/), "text outside the root element");
      } else if (node.kind === "cdata") {
        this.fail(node.start, "CDATA outside the root element");
      } else if (node.kind === "doctype") {
        if (root) this.fail(node.start, "a doctype must come before the root element");
      }
      children.push(node);
    }
    if (!root) this.fail(this.s.length, "the document has no root element");
    const doc: XDocument = { text: this.s, children, root };
    resolveNamespaces(doc, (at, m) => this.fail(at, m));
    return doc;
  }

  private startsWith(t: string): boolean {
    return this.s.startsWith(t, this.i);
  }

  private node(parent: XElement | null): XNode {
    const start = this.i;
    const s = this.s;
    if (s[start] !== "<") return this.text(parent);
    if (this.startsWith("<!--")) {
      const e = s.indexOf("-->", start + 4);
      if (e < 0) this.fail(start, "unterminated comment");
      this.i = e + 3;
      return { kind: "comment", raw: s.slice(start, this.i), start, end: this.i, parent };
    }
    if (this.startsWith("<![CDATA[")) {
      const e = s.indexOf("]]>", start + 9);
      if (e < 0) this.fail(start, "unterminated CDATA section");
      this.i = e + 3;
      return { kind: "cdata", raw: s.slice(start, this.i), start, end: this.i, parent };
    }
    if (this.startsWith("<!DOCTYPE")) {
      if (parent) this.fail(start, "a doctype is only allowed before the root element");
      this.doctypeEnd();
      this.hasDoctype = true;
      return { kind: "doctype", raw: s.slice(start, this.i), start, end: this.i, parent };
    }
    if (this.startsWith("<?")) {
      const e = s.indexOf("?>", start + 2);
      if (e < 0) this.fail(start, "unterminated processing instruction");
      this.i = e + 2;
      return { kind: "pi", raw: s.slice(start, this.i), start, end: this.i, parent };
    }
    if (this.startsWith("</")) {
      this.fail(start, "unexpected end tag");
    }
    return this.element(parent);
  }

  private doctypeEnd(): void {
    const s = this.s;
    let depth = 0;
    let quote: string | null = null;
    for (let j = this.i + 9; j < s.length; j++) {
      const c = s[j]!;
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === ">" && depth <= 0) {
        this.i = j + 1;
        return;
      }
    }
    this.fail(this.i, "unterminated doctype");
  }

  private text(parent: XElement | null): XText {
    const start = this.i;
    const e = this.s.indexOf("<", start);
    this.i = e < 0 ? this.s.length : e;
    const raw = this.s.slice(start, this.i);
    return { kind: "text", raw, value: this.decode(raw, start), start, end: this.i, parent };
  }

  decode(raw: string, at: number): string {
    if (!raw.includes("&")) return raw;
    return raw.replace(/&([^;&\s<]*);?/g, (m, body: string, off: number) => {
      if (!m.endsWith(";")) this.fail(at + off, "unterminated entity reference");
      if (body.startsWith("#x")) {
        const n = Number.parseInt(body.slice(2), 16);
        if (!/^#x[0-9a-fA-F]+$/.test(body) || n > 0x10ffff) this.fail(at + off, `bad character reference &${body};`);
        return String.fromCodePoint(n);
      }
      if (body.startsWith("#")) {
        const n = Number.parseInt(body.slice(1), 10);
        if (!/^#[0-9]+$/.test(body) || n > 0x10ffff) this.fail(at + off, `bad character reference &${body};`);
        return String.fromCodePoint(n);
      }
      const v = PREDEFINED[body];
      if (v !== undefined) return v;
      if (this.hasDoctype) return m;
      return this.fail(at + off, `unknown entity &${body};`);
    });
  }

  private name(): string {
    const s = this.s;
    const start = this.i;
    if (!NAME_START.test(s[start] ?? "")) this.fail(start, "expected a name");
    let j = start + 1;
    while (j < s.length && NAME_CHAR.test(s[j]!)) j++;
    this.i = j;
    return s.slice(start, j);
  }

  private ws(): string {
    const start = this.i;
    while (this.i < this.s.length && /[ \t\r\n]/.test(this.s[this.i]!)) this.i++;
    return this.s.slice(start, this.i);
  }

  private element(parent: XElement | null): XElement {
    const s = this.s;
    const start = this.i;
    this.i++; // <
    const name = this.name();
    const nameEnd = this.i;
    const [prefix, local] = splitName(name);
    const el: XElement = {
      kind: "element",
      name,
      prefix,
      local,
      ns: null,
      start,
      end: start,
      nameEnd,
      attrs: [],
      tagTrail: "",
      selfClosing: false,
      startTagEnd: start,
      children: [],
      endTagStart: start,
      endTrail: "",
      parent,
    };
    for (;;) {
      const ws = this.ws();
      if (this.i >= s.length) this.fail(start, `unterminated start tag <${name}>`);
      if (this.startsWith("/>")) {
        el.tagTrail = ws;
        el.selfClosing = true;
        this.i += 2;
        el.startTagEnd = this.i;
        el.endTagStart = this.i;
        el.end = this.i;
        return el;
      }
      if (s[this.i] === ">") {
        el.tagTrail = ws;
        this.i++;
        el.startTagEnd = this.i;
        break;
      }
      if (ws.length === 0) this.fail(this.i, "expected whitespace before an attribute");
      el.attrs.push(this.attr(ws, el));
    }
    for (;;) {
      if (this.i >= s.length) this.fail(s.length, `element <${name}> (line ${positionAt(s, start).line}) is not closed`);
      if (this.startsWith("</")) {
        const endTagStart = this.i;
        this.i += 2;
        const closing = this.name();
        if (closing !== name) {
          this.fail(
            endTagStart,
            `mismatched end tag </${closing}>: expected </${name}> (opened at line ${positionAt(s, start).line})`,
          );
        }
        el.endTrail = this.ws();
        if (s[this.i] !== ">") this.fail(this.i, `expected > to close </${name}`);
        this.i++;
        el.endTagStart = endTagStart;
        el.end = this.i;
        return el;
      }
      el.children.push(this.node(el));
    }
  }

  private attr(before: string, el: XElement): XAttr {
    const s = this.s;
    const start = this.i;
    const name = this.name();
    const nameEnd = this.i;
    this.ws();
    if (s[this.i] !== "=") this.fail(this.i, `expected = after attribute ${name}`);
    this.i++;
    this.ws();
    const quote = s[this.i];
    if (quote !== '"' && quote !== "'") this.fail(this.i, `attribute ${name} needs a quoted value`);
    const eq = s.slice(nameEnd, this.i);
    const valueStart = this.i + 1;
    const close = s.indexOf(quote, valueStart);
    if (close < 0) this.fail(this.i, `unterminated value of attribute ${name}`);
    const raw = s.slice(valueStart, close);
    const lt = raw.indexOf("<");
    if (lt >= 0) this.fail(valueStart + lt, `< is not allowed in attribute values`);
    if (el.attrs.some((a) => a.name === name)) this.fail(start, `duplicate attribute ${name}`);
    this.i = close + 1;
    const [prefix, local] = splitName(name);
    return {
      name,
      prefix,
      local,
      ns: null,
      before,
      eq,
      quote,
      raw,
      value: this.decode(raw.replace(/[\t\n\r]/g, " "), valueStart),
      start,
      nameEnd,
      valueStart,
      valueEnd: close,
      end: this.i,
    };
  }
}

function splitName(name: string): [string | null, string] {
  const c = name.indexOf(":");
  return c > 0 ? [name.slice(0, c), name.slice(c + 1)] : [null, name];
}

function resolveNamespaces(doc: XDocument, fail: (at: number, m: string) => never): void {
  const walk = (el: XElement, scope: ReadonlyMap<string, string>) => {
    let own: Map<string, string> | null = null;
    for (const a of el.attrs) {
      if (a.name === "xmlns" || a.prefix === "xmlns") {
        own ??= new Map(scope);
        own.set(a.name === "xmlns" ? "" : a.local, a.value);
      }
    }
    const sc = own ?? scope;
    const def = sc.get("") ?? "";
    if (el.prefix) {
      const ns = sc.get(el.prefix);
      if (ns === undefined) fail(el.start, `undeclared namespace prefix ${el.prefix}`);
      el.ns = ns;
    } else el.ns = def === "" ? null : def;
    for (const a of el.attrs) {
      if (a.name === "xmlns" || a.prefix === "xmlns") a.ns = XMLNS_NS;
      else if (a.prefix) {
        const ns = sc.get(a.prefix);
        if (ns === undefined) fail(a.start, `undeclared namespace prefix ${a.prefix}`);
        a.ns = ns;
      }
    }
    for (const c of el.children) if (c.kind === "element") walk(c, sc);
  };
  walk(doc.root, new Map([["xml", XML_NS]]));
}

/** Parse XML into a lossless tree. Throws `ChartParseFailure`. */
export function parseXml(text: string): XDocument {
  return new XmlParser(text).parse();
}

/** Re-print a tree from its tokens. */
export function printXml(doc: XDocument): string {
  return doc.children.map(printNode).join("");
}

export function printNode(n: XNode): string {
  if (n.kind !== "element") return n.raw;
  let out = "<" + n.name;
  for (const a of n.attrs) out += a.before + a.name + a.eq + a.quote + a.raw + a.quote;
  out += n.tagTrail;
  if (n.selfClosing) return out + "/>";
  out += ">";
  for (const c of n.children) out += printNode(c);
  return out + "</" + n.name + n.endTrail + ">";
}

/** Escape a value for an attribute delimited by `quote`. */
export function escapeAttr(value: string, quote: '"' | "'" = '"'): string {
  let v = value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  v = quote === '"' ? v.replace(/"/g, "&quot;") : v.replace(/'/g, "&apos;");
  return v.replace(/\n/g, "&#10;").replace(/\t/g, "&#9;").replace(/\r/g, "&#13;");
}

export function elementChildren(el: XElement): XElement[] {
  return el.children.filter((c): c is XElement => c.kind === "element");
}

export function attr(el: XElement, name: string): XAttr | undefined {
  return el.attrs.find((a) => a.name === name && a.ns === null);
}

export function attrNs(el: XElement, ns: string, local: string): XAttr | undefined {
  return el.attrs.find((a) => a.ns === ns && a.local === local);
}

/** All elements of the tree in document order. */
export function* allElements(el: XElement): Generator<XElement> {
  yield el;
  for (const c of el.children) if (c.kind === "element") yield* allElements(c);
}
