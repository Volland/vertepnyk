import type { Accessor } from "solid-js";
import type { ChartModel } from "@vertepnyk/core";
import type { EdgeInfo, Scene } from "./geometry.js";

export type Severity = "error" | "warning" | "info";
export interface CanvasDiagnostic {
  readonly severity: Severity;
  readonly message: string;
}

export interface InitialInfo {
  readonly key: string;
  /** The visible state the arrow points to. */
  readonly target: string;
}

/** What the views read. Everything reactive is an accessor so per-element memos stay narrow. */
export interface Ctx {
  readonly uid: string;
  readonly model: Accessor<ChartModel | null>;
  readonly scene: Accessor<Scene>;
  readonly edges: Accessor<Map<string, EdgeInfo>>;
  readonly initials: Accessor<Map<string, InitialInfo>>;
  readonly selection: Accessor<ReadonlySet<string>>;
  readonly tabStop: Accessor<string | null>;
  readonly single: Accessor<string | null>;
  readonly active: (id: string) => boolean;
  readonly taken: (id: string) => boolean;
  readonly diag: (id: string) => CanvasDiagnostic | undefined;
  readonly dropTarget: Accessor<string | null>;
  readonly readOnly: Accessor<boolean>;
}

export function rectEq(
  a: { x: number; y: number; w: number; h: number } | undefined,
  b: { x: number; y: number; w: number; h: number } | undefined,
): boolean {
  return a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
}

export function arrEq<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
