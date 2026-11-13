/**
 * Violations as vertep reports them, normalized into one shape the diagnostics list and the
 * canvas can use. Nothing is added or suppressed: one vertep violation becomes one
 * `Violation`, and the original is kept in `raw`.
 *
 * vertep's locations come in several forms, depending on which reader or check found them:
 * - SCXML reader: 1-based `line`/`column`, no path (`transition target names unknown state …`);
 * - YAML reader and CEL type checker: `line`/`column` and a document `path`
 *   (`states.a.on.go.target`, `states.shopping.states.cart.on.add[0].actions[1]`);
 * - core validator: the message is the Rust debug form of the rule
 *   (`IllegalInitialTarget { target: "b" }`) and `path` the debug form of the node
 *   (`Initial { state: "a" }`);
 * - registration refusals: a message only, line 0.
 */
// @tg: implements:: [[openspec:chart-validation#Diagnostics are located]] {confidence: partial, note: "location data only; selecting and revealing is the canvas"}
// @tg: implements:: [[openspec:chart-validation#Validation runs on vertep]]

import type { Violation as VertepViolation } from "@vertep/web";

/** One problem of a chart, as vertep reported it, with every location vertep gave. */
export interface Violation {
  /** vertep's error code; every validation violation comes from `ChartInvalid`. */
  readonly code: "ChartInvalid";
  /** Every vertep violation is an error: an invalid chart does not register. */
  readonly severity: "error";
  /** vertep's message, unchanged. */
  readonly message: string;
  /** The rule's name when vertep gives it (core validator kinds such as `IllegalInitialTarget`). */
  readonly rule?: string;
  /** 1-based line in the chart text, when known. */
  readonly line?: number;
  /** 1-based column in the chart text, when known. */
  readonly column?: number;
  /** vertep's node path: a YAML document path or a core node, when given. */
  readonly path?: string;
  /** The state the violation concerns, when the path or message names it. */
  readonly stateId?: string;
  /** The transition it concerns: its source, and its index or event when known. */
  readonly transition?: { readonly source: string; readonly index?: number; readonly event?: string };
  /** The violation exactly as vertep reported it. */
  readonly raw: VertepViolation;
}

const RUST_DEBUG = /^([A-Z][A-Za-z0-9]*)(?:\s*\{.*\}|\(.*\))?$/s;

/** One vertep violation in the normalized shape. */
export function normalizeViolation(v: VertepViolation): Violation {
  const out: {
    -readonly [K in keyof Violation]: Violation[K];
  } = { code: "ChartInvalid", severity: "error", message: v.message, raw: v };
  const rule = v.message.match(RUST_DEBUG)?.[1];
  if (rule) out.rule = rule;
  if (v.line > 0) {
    out.line = v.line;
    if (v.column > 0) out.column = v.column;
  }
  if (v.path) out.path = v.path;

  let stateId: string | undefined;
  let transition: { source: string; index?: number; event?: string } | undefined;

  if (v.path && /^states[.[]/.test(v.path)) {
    // a YAML document path: the innermost `states.<id>` names the state
    const seg = parseYamlPath(v.path);
    for (let i = 0; i < seg.length - 1; i++) {
      if (seg[i] === "states" && typeof seg[i + 1] === "string") {
        stateId = seg[i + 1] as string;
        transition = undefined;
        const kind = seg[i + 2];
        if (kind === "on" && typeof seg[i + 3] === "string") {
          transition = { source: stateId, event: seg[i + 3] as string };
        } else if (kind === "always") {
          transition = { source: stateId };
        }
      }
    }
  } else if (v.path) {
    // a core node in Rust debug form: `Initial { state: "a" }`, `State("a")`,
    // `Transition { state: "a", index: 0 }`
    const s = v.path.match(/state:\s*"((?:[^"\\]|\\.)*)"/) ?? v.path.match(/^State\("((?:[^"\\]|\\.)*)"\)/);
    if (s?.[1]) stateId = s[1];
    const idx = v.path.match(/index:\s*(\d+)/);
    if (stateId && /^Transition\b/.test(v.path)) {
      transition = { source: stateId, ...(idx ? { index: Number(idx[1]) } : {}) };
    }
  }

  // the type checker names the state and transition in the message:
  // `state "cart", transition 0 (on add), action 1: …`
  const m = v.message.match(/^state "((?:[^"\\]|\\.)*)"(?:, transition (\d+)(?: \(on ([^)]*)\))?)?/);
  if (m?.[1]) {
    stateId ??= m[1];
    if (m[2] !== undefined) {
      transition = {
        source: m[1],
        index: Number(m[2]),
        ...(m[3] ? { event: m[3] } : transition?.event ? { event: transition.event } : {}),
      };
    }
  }
  // duplicate ids: `state id \`a\` is already declared at 1:74`
  const dup = v.message.match(/^state id `([^`]+)`/);
  if (dup?.[1]) stateId ??= dup[1];

  if (stateId !== undefined) out.stateId = stateId;
  if (transition) out.transition = transition;
  return out;
}

/** `states.a.on.go[0].target` as `["states", "a", "on", "go", 0, "target"]`. */
function parseYamlPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  for (let m = re.exec(path); m; m = re.exec(path)) {
    if (m[2] !== undefined) out.push(Number(m[2]));
    else if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}
