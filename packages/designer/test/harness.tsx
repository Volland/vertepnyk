import { createMemoryHost, type MemoryHost } from "@vertepnyk/host-bridge";
import { createInProcessLayout } from "@vertepnyk/layout";
import { Designer, mountDesigner, type DesignerHandle } from "../src/index.js";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(f: () => T | false | null | undefined, ms = 15000): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error("timeout waiting for condition");
    await wait(25);
  }
}

export interface Mounted {
  el: HTMLElement;
  host: MemoryHost;
  handle: DesignerHandle;
  q<T extends Element = HTMLElement>(sel: string): T | null;
  qa<T extends Element = HTMLElement>(sel: string): T[];
  click(sel: string): void;
  dispose(): void;
}

const live: Mounted[] = [];
export function cleanup(): void {
  for (const m of live.splice(0)) m.dispose();
}

export async function open(text: string, fileName = "chart.scxml"): Promise<Mounted> {
  const host = createMemoryHost({ fileName, format: fileName.endsWith(".scxml") ? "scxml" : "yaml", text });
  const el = document.createElement("div");
  document.body.appendChild(el);
  let handle!: DesignerHandle;
  const dispose = mountDesigner(el, host, { layoutClient: createInProcessLayout(), validationDelayMs: 20 }, (h) => (handle = h));
  const m: Mounted = {
    el,
    host,
    handle,
    q: (s) => el.querySelector(s),
    qa: (s) => [...el.querySelectorAll(s)] as never,
    click(s) {
      const n = el.querySelector<HTMLElement>(s);
      if (!n) throw new Error(`no element ${s}`);
      n.click();
    },
    dispose() {
      dispose();
      el.remove();
    },
  };
  Object.defineProperty(m, "handle", { get: () => handle });
  live.push(m);
  return m;
}
export { Designer };
