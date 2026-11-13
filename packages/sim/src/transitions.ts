/**
 * Transitions taken, as vertep reports them, and the events that triggered them.
 *
 * vertep names a transition by its node IRI, `<version>#s.<source>:t<index>`, where `index` is
 * the transition's position among its source state's transitions in document order; the same
 * pair is `@vertepnyk/core`'s transition id `${source}#${index}`.
 *
 * vertep's journal lists every transition a macrostep took, in order, but not the internal
 * events (`<raise>`, internal `<send>`) that triggered the later ones. Those are inferred here
 * from the event descriptors of the transitions vertep took, which a `TransitionIndex` gives:
 * the built-in one reads SCXML text; hosts pass one built from their model for YAML.
 */
// @tg: implements:: [[openspec:chart-simulation#Event log]] {confidence: partial, note: "internal events are inferred from the descriptors of the transitions vertep took"}
// @tg: implements:: [[openspec:chart-simulation#Active configuration is highlighted]] {confidence: partial, note: "the data: configuration and taken transitions"}

import { type Format, stripXmlNoise } from "./engine.js";

/** A transition a macrostep took. */
export interface TakenTransition {
  /** `${source}#${index}`, the transition id `@vertepnyk/core` uses. */
  readonly id: string;
  /** The source state id. */
  readonly source: string;
  /** Its position among the source's transitions in document order; null when unknown. */
  readonly index: number | null;
  /** The target state ids; empty for a targetless transition. */
  readonly targets: readonly string[];
  /** vertep's node IRI of the transition. */
  readonly iri: string;
  /** Its event descriptors when the transition index knows them; empty for eventless. */
  readonly events?: readonly string[];
}

/** An internal event of a macrostep, inferred from the transitions it triggered. */
export interface InternalEvent {
  /** The event name, or the descriptor that matched it. */
  readonly name: string;
  /** The descriptors of the transition(s) it triggered. */
  readonly descriptors: readonly string[];
  /** Ids of the transitions it triggered. */
  readonly transitions: readonly string[];
  /** Always true: vertep does not report internal events; see the module comment. */
  readonly inferred: true;
}

/** Event descriptors of a transition by its id (`${source}#${index}`); undefined when unknown. */
export type TransitionIndex = (id: string) => readonly string[] | undefined;

/** Source and index from a transition node IRI (`…#s.cart:t1`). */
export function decodeTransitionIri(iri: string): { source: string; index: number | null } {
  const hash = iri.lastIndexOf("#");
  const frag = hash >= 0 ? iri.slice(hash + 1) : iri;
  const t = frag.lastIndexOf(":t");
  const head = t >= 0 ? frag.slice(0, t) : frag;
  const idx = t >= 0 ? Number(frag.slice(t + 2)) : NaN;
  return { source: head.startsWith("s.") ? head.slice(2) : head, index: Number.isInteger(idx) ? idx : null };
}

const STATE_ELEMENTS = new Set(["scxml", "state", "parallel", "final"]);
const OTHER_CONTAINERS = new Set(["initial", "history"]);

/**
 * The event descriptors of every transition of an SCXML chart, by `${source}#${index}`.
 * A tag scanner, not a parser: enough to label transitions vertep reports.
 */
export function scxmlTransitionIndex(text: string): TransitionIndex {
  const map = new Map<string, readonly string[]>();
  const stack: { name: string; id: string | null; count: number }[] = [];
  const src = stripXmlNoise(text);
  const tag = /<(\/?)([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    const closing = m[1] === "/";
    const prefixed = !!m[2];
    const name = m[3] ?? "";
    const attrs = m[4] ?? "";
    const selfClosing = m[5] === "/";
    if (prefixed) continue;
    if (closing) {
      // pop to the matching element
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (name === "transition") {
      const owner = stack[stack.length - 1];
      if (owner && STATE_ELEMENTS.has(owner.name) && owner.id !== null) {
        const ev = attr(attrs, "event");
        map.set(`${owner.id}#${owner.count}`, ev ? ev.split(/\s+/).filter(Boolean) : []);
        owner.count++;
      }
      if (!selfClosing) stack.push({ name, id: null, count: 0 });
      continue;
    }
    if (selfClosing) continue;
    if (STATE_ELEMENTS.has(name)) stack.push({ name, id: name === "scxml" ? null : attr(attrs, "id"), count: 0 });
    else if (OTHER_CONTAINERS.has(name)) stack.push({ name, id: null, count: 0 });
    else stack.push({ name, id: null, count: 0 });
  }
  return (id) => map.get(id);
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}

/** The default transition index: SCXML from its text; none for YAML. */
export function defaultTransitionIndex(text: string, format: Format): TransitionIndex {
  return format === "scxml" ? scxmlTransitionIndex(text) : () => undefined;
}

/** Whether descriptor `d` matches event `name` (SCXML 3.12.1: token prefix, `*`, `.*`). */
export function descriptorMatches(d: string, name: string): boolean {
  if (d === "*") return true;
  const core = d.endsWith(".*") ? d.slice(0, -2) : d.endsWith(".") ? d.slice(0, -1) : d;
  return name === core || name.startsWith(`${core}.`);
}

/**
 * The internal events of a macrostep. The transitions vertep lists are in microstep order:
 * first those the external event enabled, then eventless ones and those of internal events.
 * Every transition after the external event's whose descriptors do not match the external
 * event is attributed to an internal event named by its descriptor.
 */
export function inferInternalEvents(external: string, transitions: readonly TakenTransition[]): InternalEvent[] {
  const out: { name: string; descriptors: string[]; transitions: string[]; inferred: true }[] = [];
  let externalPhase = true;
  for (const t of transitions) {
    const ds = t.events;
    if (ds === undefined) {
      externalPhase = false;
      continue;
    }
    if (externalPhase && ds.some((d) => descriptorMatches(d, external))) continue;
    externalPhase = false;
    if (ds.length === 0) continue; // eventless
    const name = ds.length === 1 ? (ds[0] as string).replace(/\.\*?$/, "") : ds.join(" ");
    const last = out[out.length - 1];
    if (last && last.name === name) last.transitions.push(t.id);
    else out.push({ name, descriptors: [...ds], transitions: [t.id], inferred: true });
  }
  return out;
}
