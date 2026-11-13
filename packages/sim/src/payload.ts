/**
 * Payload type checks for typed charts, by vertep.
 *
 * `@vertep/web` has no call that checks a payload against an event's declared type: `send`
 * resolves for an ill-typed payload, and inside the actor vertep replaces the event with
 * `error.execution` (`kind: "execution"`, `message`), which nothing outside the chart sees.
 * So the check runs on a probe: a one-state chart with the same `types` and `events`
 * declarations that moves to `bad` and keeps vertep's message when it receives
 * `error.execution`. The probe gets the event first; only a payload vertep admits is sent to
 * the run. The type check, and its message, are vertep's.
 *
 * Typed YAML charts (top-level `events`) are probed; SCXML charts are not (their typing is
 * spread over `vt:` attributes) and pass unchecked.
 */
// @tg: implements:: [[openspec:chart-simulation#Send events with payload]] {confidence: partial, note: "typed YAML charts; SCXML payloads are not pre-checked"}

import type { ActorSystem, JsonValue } from "@vertep/web";
import type { Format } from "./engine.js";

/** The result of a payload check. */
export type PayloadCheck =
  | { readonly ok: true; /** false when the chart declares no payload types to check */ readonly checked: boolean }
  | { readonly ok: false; readonly message: string };

/** A top-level YAML block (`key:` at column 0 and its indented lines), or null. */
export function yamlTopLevelBlock(text: string, key: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}[ \\t]*:`).test(l));
  if (start < 0) return null;
  const out = [lines[start] as string];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] as string;
    if (/^[^\s#]/.test(l)) break;
    out.push(l);
  }
  return out.join("\n");
}

/** The probe chart for a typed YAML chart, or null when it declares no event types. */
export function payloadProbeChart(text: string, format: Format): string | null {
  if (format !== "yaml") return null;
  const events = yamlTopLevelBlock(text, "events");
  if (!events || /^events[ \t]*:[ \t]*(\{\s*\}|null|~)?[ \t]*(#.*)?$/.test(events.trim())) return null;
  const types = yamlTopLevelBlock(text, "types") ?? "";
  return [
    "vertep: 1",
    "name: vertepnyk-payload-probe",
    "datamodel: cel",
    types,
    events,
    "context:",
    `  vertepnyk_error: { type: string, init: "''" }`,
    "initial: probe",
    "states:",
    "  probe:",
    "    on:",
    "      error.execution:",
    "        - target: bad",
    "          actions:",
    "            - assign: { location: ctx.vertepnyk_error, expr: \"ev.data.message\" }",
    "  bad: {}",
    "",
  ].join("\n");
}

/** Checks payloads on probe actors in `system`. */
export class PayloadChecker {
  readonly #probe: string | null;
  #registered: Promise<void> | null = null;

  constructor(text: string, format: Format) {
    this.#probe = payloadProbeChart(text, format);
  }

  /** Whether the chart has payload types to check. */
  get typed(): boolean {
    return this.#probe !== null;
  }

  /** Checks `payload` of event `name` against the chart's declarations, on vertep. */
  async check(system: ActorSystem, name: string, payload: JsonValue | undefined): Promise<PayloadCheck> {
    const probe = this.#probe;
    if (!probe) return { ok: true, checked: false };
    try {
      this.#registered ??= system.register(probe, { format: "yaml" }).then(() => undefined);
      await this.#registered;
    } catch {
      // the declarations alone do not register (the chart itself will say why): no check
      this.#registered = null;
      return { ok: true, checked: false };
    }
    const actor = await system.spawn(probe, { format: "yaml" });
    await actor.send(payload === undefined ? { type: name } : { type: name, data: payload });
    const s = await actor.getSnapshot();
    if (s.configuration.includes("bad")) {
      const ctx = s.context as { vertepnyk_error?: unknown } | null;
      const message = typeof ctx?.vertepnyk_error === "string" && ctx.vertepnyk_error ? ctx.vertepnyk_error : `the payload of event \`${name}\` does not have its declared type`;
      return { ok: false, message };
    }
    return { ok: true, checked: true };
  }
}
