import { For, Show, type JSX } from "solid-js";
import type { ProblemItem } from "./problems.js";

// @tg: implements:: [[openspec:chart-validation#Diagnostics are located]] {confidence: partial, note: "list and reveal; canvas markers come from the diagnostics map"}
export function ProblemsPanel(props: {
  items: readonly ProblemItem[];
  validation: string;
  version?: string;
  onSelect: (p: ProblemItem) => void;
}): JSX.Element {
  return (
    <div class="vd-panel" data-testid="problems-panel">
      <Show when={props.items.length === 0}>
        <p class="vd-hint" data-testid="no-problems">
          {props.validation === "pending" ? "Checking on vertep..." : "No problems found."}
        </p>
      </Show>
      <ul class="vd-problems">
        <For each={props.items}>
          {(p) => (
            <li>
              <button type="button" class="vd-problem" data-testid="problem" data-severity={p.severity} data-element={p.elementId ?? ""} onClick={() => props.onSelect(p)}>
                <span class="vd-sev" aria-label={p.severity}>{p.severity === "error" ? "!" : p.severity === "warning" ? "?" : "i"}</span>
                <span class="vd-pmsg">{p.message}</span>
                <span class="vd-ploc vd-mono">
                  {p.elementId ? `${p.elementId} ` : ""}
                  {p.line !== undefined ? `${p.line}${p.column !== undefined ? `:${p.column}` : ""}` : ""}
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
