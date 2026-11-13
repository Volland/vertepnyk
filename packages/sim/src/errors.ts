/** Errors of the simulator. */

import type { Violation } from "./violations.js";

/** Why the simulator refused a call. */
export type SimulationErrorCode =
  /** No run: `start` first. */
  | "NotStarted"
  /** The viewed step is after a top-level final state: reset or travel back first. */
  | "RunDone"
  /** vertep refused the event's payload for the event's declared type; nothing was sent. */
  | "PayloadType"
  /** The chart has violations; see `violations`. */
  | "ChartInvalid"
  /** No such step or run. */
  | "NotFound"
  /** The simulator was disposed. */
  | "Disposed";

/** A refusal of the simulator, with a code to branch on. */
export class SimulationError extends Error {
  readonly code: SimulationErrorCode;
  readonly violations: readonly Violation[];

  constructor(code: SimulationErrorCode, message: string, violations: readonly Violation[] = []) {
    super(message);
    this.name = "SimulationError";
    this.code = code;
    this.violations = violations;
  }
}

/** vertep refused an event's payload for its declared type; the event was not sent. */
export class PayloadTypeError extends SimulationError {
  /** The event name. */
  readonly event: string;
  /** The refused payload. */
  readonly payload: unknown;

  constructor(event: string, payload: unknown, message: string) {
    super("PayloadType", message);
    this.name = "PayloadTypeError";
    this.event = event;
    this.payload = payload;
  }
}
