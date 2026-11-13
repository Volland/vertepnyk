/**
 * @vertepnyk/sim — validation and simulation of charts on vertep's WebAssembly interpreter
 * (`@vertep/web`). The designer never computes transitions: everything here is what vertep
 * reports, normalized for the canvas, inspector and diagnostics list.
 *
 * - `Validator`: register-in-a-scratch-system validation with stale-result suppression,
 *   `liveValidation`/`debounce` for edit-driven use.
 * - `Simulator`: runs as journaled actors, enabled events, event log, time travel, forks,
 *   replay after edits, typed payload checks.
 *
 * Works in Node.js (worker threads) and browsers (module workers); hosts that serve vertep's
 * worker and WebAssembly as assets pass `workerUrl` and `ecmascriptBuild`.
 */

export { type BuildKind, type EngineOptions, type Format, buildFor, declaredDatamodel } from "./engine.js";
export { type Violation, normalizeViolation } from "./violations.js";
export {
  type Debounced,
  type LiveValidation,
  type ValidationResult,
  type ValidatorOptions,
  Validator,
  debounce,
  liveValidation,
} from "./validator.js";
export { type Context, changedKeys, normalizeContext } from "./context.js";
export {
  type InternalEvent,
  type TakenTransition,
  type TransitionIndex,
  decodeTransitionIri,
  defaultTransitionIndex,
  descriptorMatches,
  inferInternalEvents,
  scxmlTransitionIndex,
} from "./transitions.js";
export { type PayloadCheck, PayloadChecker, payloadProbeChart } from "./payload.js";
export { PayloadTypeError, SimulationError, type SimulationErrorCode } from "./errors.js";
export {
  type EventCandidate,
  type LogEntry,
  type RunInfo,
  type RunState,
  type SimulatorOptions,
  type StartResult,
  type StepEvent,
  Simulator,
} from "./simulator.js";
