/**
 * The contract of @vertepnyk/core: the semantic view of a chart, the edit commands and the
 * document API that every other package (canvas, inspector, sim, hosts) builds against.
 *
 * The chart text is the only source of truth. A `ChartModel` is derived from the text's
 * concrete syntax tree on every parse; commands become minimal `TextPatch`es on the text.
 */

/** The two chart surfaces. */
export type Format = "scxml" | "yaml";

/** A half-open range of UTF-16 offsets into the chart text. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Replace `[start, end)` of the text the patch was computed against with `text`. */
export interface TextPatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** 1-based line and column of an offset. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

export type StateKind = "atomic" | "compound" | "parallel" | "final" | "history";

/** Where a compound state's initial configuration comes from. */
export type InitialSource = "attribute" | "element" | "implicit";

/** One state of the chart. Ids are unique in the chart. */
export interface StateNode {
  readonly id: string;
  readonly kind: StateKind;
  /** For history states. */
  readonly historyType?: "shallow" | "deep";
  /** The parent state's id; null for top-level states. */
  readonly parent: string | null;
  /** Child state ids in document order. */
  readonly children: readonly string[];
  /** Explicit initial targets of a compound state (attribute, key or `<initial>` element). */
  readonly initial: readonly string[];
  readonly initialSource: InitialSource;
  /** Transition ids of this state's own transitions, in document order. */
  readonly transitions: readonly string[];
  readonly onentry: readonly ContentBlock[];
  readonly onexit: readonly ContentBlock[];
  /** True when the source gave no id and one was generated (SCXML allows id-less states). */
  readonly generatedId: boolean;
  /** The whole element (SCXML) or mapping entry (YAML). */
  readonly span: Span;
}

/** One transition. `id` is `${source}#${index}` and is stable only within one parse. */
export interface TransitionNode {
  readonly id: string;
  readonly source: string;
  /** Position among `source`'s transitions in document order. */
  readonly index: number;
  /** Event descriptors (SCXML `event` split on whitespace); empty for eventless. */
  readonly events: readonly string[];
  readonly cond?: string;
  /** Target ids; empty for a targetless transition. */
  readonly targets: readonly string[];
  readonly type: "external" | "internal";
  readonly actions: readonly ContentItem[];
  readonly span: Span;
}

/** One `<onentry>`/`<onexit>` block (SCXML allows several) or YAML `entry`/`exit` list. */
export interface ContentBlock {
  readonly items: readonly ContentItem[];
  readonly span: Span;
}

/** Executable content. Anything not modeled is `opaque` and is preserved verbatim. */
export type ContentItem =
  | { readonly kind: "assign"; readonly location: string; readonly expr: string; readonly span?: Span }
  | { readonly kind: "raise"; readonly event: string; readonly span?: Span }
  | {
      readonly kind: "send";
      readonly event?: string;
      readonly eventexpr?: string;
      readonly target?: string;
      readonly type?: string;
      readonly delay?: string;
      readonly sendid?: string;
      readonly params?: readonly { readonly name: string; readonly expr: string }[];
      readonly span?: Span;
    }
  | { readonly kind: "log"; readonly label?: string; readonly expr?: string; readonly span?: Span }
  | { readonly kind: "cancel"; readonly sendid?: string; readonly sendidexpr?: string; readonly span?: Span }
  | {
      readonly kind: "if";
      /** `if`, then each `elseif`, then `else` (cond undefined). */
      readonly branches: readonly { readonly cond?: string; readonly actions: readonly ContentItem[] }[];
      readonly span?: Span;
    }
  | {
      readonly kind: "foreach";
      readonly array: string;
      readonly item: string;
      readonly index?: string;
      readonly actions: readonly ContentItem[];
      readonly span?: Span;
    }
  /** `script`, `vt:` and foreign extensions, anything else: shown read-only, kept byte for byte. */
  | { readonly kind: "opaque"; readonly label: string; readonly source: string; readonly span: Span };

/** A datamodel item (SCXML `<data>`, YAML `context` entry). */
export interface DataItem {
  readonly id: string;
  /** Initial value expression (SCXML `expr`, YAML `init`). */
  readonly expr?: string;
  /** Declared type (typed CEL charts). */
  readonly type?: string;
  /** The owning state; null for the chart's top-level datamodel. */
  readonly owner: string | null;
  readonly span: Span;
}

/**
 * Layout of one state, relative to its parent's top-left corner (top-level states: the
 * canvas origin). Units are CSS pixels at zoom 1.
 */
export interface StateLayout {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly collapsed?: boolean;
}

/** Layout of one transition: the full absolute polyline (start, bends, end) and the absolute label centre. */
export interface TransitionLayout {
  readonly route?: readonly (readonly [number, number])[];
  readonly label?: readonly [number, number];
}

/** The semantic view of one parse. Immutable; a new one is produced per text change. */
export interface ChartModel {
  readonly format: Format;
  readonly name?: string;
  readonly datamodel?: string;
  /** The chart's initial targets (root `initial`); empty = first top-level state. */
  readonly initial: readonly string[];
  /** Top-level state ids in document order. */
  readonly roots: readonly string[];
  readonly states: ReadonlyMap<string, StateNode>;
  readonly transitions: ReadonlyMap<string, TransitionNode>;
  readonly data: readonly DataItem[];
  /** Known event names: declared (YAML `events`) plus every descriptor used, deduplicated, sorted. */
  readonly events: readonly string[];
  /** Declared payload types of events (YAML typed charts). */
  readonly eventTypes: ReadonlyMap<string, string>;
  /** Layout entries keyed by state id; only states that have one. */
  readonly layout: ReadonlyMap<string, StateLayout>;
  /** Layout entries keyed by transition id (`source#index`). */
  readonly transitionLayout: ReadonlyMap<string, TransitionLayout>;
}

/** Where executable content lives. */
export type ContentOwner =
  | { readonly state: string; readonly slot: "onentry" | "onexit" }
  | { readonly transition: string };

/** A structural or property edit. Every command maps to minimal text patches. */
export type Command =
  | { readonly type: "addState"; readonly parent: string | null; readonly kind: StateKind; readonly id?: string; readonly historyType?: "shallow" | "deep"; readonly layout?: StateLayout }
  | { readonly type: "removeState"; readonly id: string }
  | { readonly type: "renameState"; readonly id: string; readonly newId: string }
  | { readonly type: "reparentState"; readonly id: string; readonly parent: string | null; readonly index?: number }
  | { readonly type: "setStateKind"; readonly id: string; readonly kind: StateKind; readonly historyType?: "shallow" | "deep" }
  | { readonly type: "setInitial"; readonly state: string | null; readonly initial: readonly string[] }
  | { readonly type: "addTransition"; readonly source: string; readonly targets: readonly string[]; readonly events?: readonly string[]; readonly cond?: string; readonly transitionType?: "external" | "internal" }
  | { readonly type: "removeTransition"; readonly id: string }
  | {
      readonly type: "updateTransition";
      readonly id: string;
      readonly source?: string;
      readonly events?: readonly string[];
      /** null removes the condition. */
      readonly cond?: string | null;
      readonly targets?: readonly string[];
      readonly transitionType?: "external" | "internal";
    }
  | { readonly type: "setContent"; readonly owner: ContentOwner; readonly items: readonly ContentItem[] }
  | { readonly type: "addData"; readonly owner: string | null; readonly id: string; readonly expr?: string; readonly dataType?: string }
  | { readonly type: "updateData"; readonly id: string; readonly newId?: string; readonly expr?: string | null; readonly dataType?: string | null }
  | { readonly type: "removeData"; readonly id: string }
  | { readonly type: "setLayout"; readonly states?: Readonly<Record<string, StateLayout | null>>; readonly transitions?: Readonly<Record<string, TransitionLayout | null>> }
  | { readonly type: "setChartProps"; readonly name?: string | null; readonly datamodel?: string | null };

/** A command that cannot be applied (unknown id, duplicate id, cycle, ...). Text is unchanged. */
export class EditError extends Error {
  constructor(
    readonly code: "UnknownId" | "DuplicateId" | "InvalidId" | "Cycle" | "Unsupported" | "ParseError",
    message: string,
  ) {
    super(message);
    this.name = "EditError";
  }
}

/** The text could not be parsed. */
export interface ParseError {
  readonly message: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** Why the document changed. */
export type ChangeOrigin = "edit" | "external" | "undo" | "redo";

export interface DocumentChange {
  readonly text: string;
  /** Patches against the previous text (empty for external replacement). */
  readonly patches: readonly TextPatch[];
  /** The last successfully parsed model (kept when the new text does not parse). */
  readonly model: ChartModel | null;
  readonly error: ParseError | null;
  readonly origin: ChangeOrigin;
}
