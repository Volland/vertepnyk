import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "solid-js/web";
import { ChartDocument, type Format } from "@vertepnyk/core";
import { Inspector, type InspectorProps } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (n: string): string => readFileSync(join(here, "../../../fixtures", n), "utf8");
export const fmt = (n: string): Format => (n.endsWith(".scxml") ? "scxml" : "yaml");

export function open(name: string): ChartDocument {
  return ChartDocument.open(fixture(name), fmt(name));
}

export function mount(doc: ChartDocument, selection: readonly string[], extra: Partial<InspectorProps> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const dispose = render(() => <Inspector doc={doc} selection={selection} debounceMs={0} {...extra} />, root);
  return {
    root,
    dispose: () => {
      dispose();
      root.remove();
    },
  };
}

/** The control labelled `text` (exact match) inside `scope`; `nth` picks among several. */
export function byLabel(scope: ParentNode, text: string, nth = 0): HTMLInputElement | HTMLSelectElement {
  const labels = [...scope.querySelectorAll("label")].filter((l) => l.textContent === text);
  const l = labels[nth];
  if (!l) throw new Error(`no label ${text}[${nth}]`);
  return scope.querySelector<HTMLInputElement>(`[id="${l.getAttribute("for")}"]`)!;
}

export function type(el: HTMLInputElement | HTMLSelectElement, value: string, event: "input" | "change" = "input"): void {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

export function choose(select: HTMLSelectElement | null, value: string): void {
  if (!select) throw new Error("no select");
  type(select, value, "change");
}

export const byAria = (scope: ParentNode, label: string): HTMLElement => {
  const el = scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no aria-label ${label}`);
  return el;
};

export const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** Two-format chart with a state `payment` (the same intent in SCXML and YAML). */
export const PAYMENT_SCXML = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="payment">
  <datamodel><data id="attempts" expr="0"/></datamodel>
  <state id="payment">
    <transition event="pay" target="done"/>
  </state>
  <state id="done"/>
</scxml>
`;
export const PAYMENT_YAML = `vertep: 1
name: pay
datamodel: ecmascript
context:
  attempts: { init: "0" }
initial: payment
states:
  payment:
    on: { pay: done }
  done: {}
`;
