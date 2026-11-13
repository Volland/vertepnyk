import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { ChartDocument } from "@vertepnyk/core";
import { DARK_THEME, LIGHT_THEME, type ThemeTokens } from "@vertepnyk/host-bridge";
import { Canvas, type CanvasApi, type CanvasProps, type Viewport } from "../src/index.js";

export const NS = "http://www.w3.org/2005/07/scxml";

export function scxml(body: string, initial?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<scxml xmlns="${NS}" version="1.0"${initial ? ` initial="${initial}"` : ""}>\n${body}\n</scxml>\n`;
}

/** Fixes layout so geometry in tests is deterministic: id -> [x, y, w, h] relative to the parent. */
export function place(doc: ChartDocument, layout: Record<string, [number, number, number, number]>): void {
  const states: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [id, [x, y, w, h]] of Object.entries(layout)) states[id] = { x, y, w, h };
  doc.apply({ type: "setLayout", states });
}

export interface Mounted {
  readonly container: HTMLElement;
  readonly api: () => CanvasApi;
  readonly theme: Accessor<ThemeTokens>;
  readonly setTheme: (t: ThemeTokens) => void;
  readonly selection: Accessor<readonly string[]>;
  readonly viewport: Accessor<Viewport>;
  readonly setViewport: (v: Viewport) => void;
  readonly dispose: () => void;
  readonly svg: SVGSVGElement;
}

export function mount(doc: ChartDocument, extra: Partial<CanvasProps> = {}): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const [theme, setTheme] = createSignal<ThemeTokens>(LIGHT_THEME);
  const [selection, setSelection] = createSignal<readonly string[]>([]);
  const [viewport, setViewport] = createSignal<Viewport>({ x: 0, y: 0, zoom: 1 });
  let api!: CanvasApi;
  const dispose = render(
    () => (
      <Canvas
        doc={doc}
        theme={theme()}
        selection={selection()}
        onSelectionChange={setSelection}
        viewport={viewport()}
        onViewportChange={setViewport}
        apiRef={(a) => (api = a)}
        {...extra}
      />
    ),
    container,
  );
  return {
    container,
    api: () => api,
    theme,
    setTheme,
    selection,
    viewport,
    setViewport,
    dispose: () => {
      dispose();
      container.remove();
    },
    svg: container.querySelector("svg.vt-svg") as SVGSVGElement,
  };
}

export function pointer(el: Element, type: string, x: number, y: number, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }));
}

export function click(el: Element, x: number, y: number, init: MouseEventInit = {}): void {
  pointer(el, "pointerdown", x, y, init);
  pointer(el, "pointerup", x, y, init);
}

export function stateEl(m: Mounted, id: string): Element {
  const el = m.container.querySelector(`[data-state-id="${id}"]`);
  if (!el) throw new Error(`no state element ${id}`);
  return el;
}

export function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k, ...init }));
}

export { DARK_THEME, LIGHT_THEME };
