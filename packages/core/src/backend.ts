/** The interface each chart format implements, and the edit session commands run in. */
import type { ChartModel, Command, Format, TextPatch } from "./model.js";
import { ChartParseFailure } from "./errors.js";
import { applyPatches, composePatches } from "./text.js";

/** vertep's reserved layout namespace (SCXML attributes `vl:*`, YAML top-level `layout`). */
export const VL_NS = "https://w3id.org/vertep/layout#";
export const SCXML_NS = "http://www.w3.org/2005/07/scxml";

/** One successful parse of a chart text. */
export interface Parsed {
  readonly text: string;
  readonly model: ChartModel;
}

export interface Backend<P extends Parsed = Parsed> {
  readonly format: Format;
  /** Throws `ChartParseFailure`. */
  parse(text: string): P;
  /** Apply one command by committing patches to the session. Throws `EditError`. */
  apply(session: EditSession<P>, cmd: Command): void;
}

/** Patches committed since a `mark()`, relative to the text at that point. */
export interface Mark {
  readonly base: string;
  patches: TextPatch[];
}

/**
 * A sequence of patch commits on a text, re-parsing after each commit, with the accumulated
 * patches kept relative to the original text.
 */
export class EditSession<P extends Parsed> {
  readonly original: string;
  patches: TextPatch[] = [];
  parsed: P;
  private readonly parseFn: (text: string) => P;

  constructor(parseFn: (text: string) => P, parsed: P) {
    this.parseFn = parseFn;
    this.parsed = parsed;
    this.original = parsed.text;
  }

  get text(): string {
    return this.parsed.text;
  }

  get model(): ChartModel {
    return this.parsed.model;
  }

  private readonly marks = new Set<Mark>();

  /** Start collecting the patches committed from now on (relative to the current text). */
  mark(): Mark {
    const m: Mark = { base: this.text, patches: [] };
    this.marks.add(m);
    return m;
  }

  release(m: Mark): void {
    this.marks.delete(m);
  }

  commit(patches: readonly TextPatch[]): void {
    const ps = patches.filter((p) => !(p.start === p.end && p.text === "") && this.text.slice(p.start, p.end) !== p.text);
    if (ps.length === 0) return;
    const next = applyPatches(this.text, ps);
    this.patches = composePatches(this.original, this.patches, ps);
    for (const m of this.marks) m.patches = composePatches(m.base, m.patches, ps);
    try {
      this.parsed = this.parseFn(next);
    } catch (e) {
      const m = e instanceof ChartParseFailure ? e.message : String(e);
      throw new Error(`internal error: an edit produced unparseable text: ${m}\n${next}`);
    }
  }
}
