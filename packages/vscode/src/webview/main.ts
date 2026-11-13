/**
 * The webview page: waits for `init`, builds the VS Code host over `postMessage` and mounts
 * the designer. No inline script runs (the page's CSP allows only this nonce'd module); the
 * extension's folder URL comes from a data attribute on the root element.
 */
import { detectFormat, type Command } from "@vertepnyk/core";
import { LayoutCancelledError, createLayoutWorker, type LayoutClient } from "@vertepnyk/layout";
import { mountDesigner, type DesignerHandle, type DesignerUiOptions } from "@vertepnyk/designer";
import type { ThemeTokens } from "@vertepnyk/host-bridge";
import { isHostMessage, type HostMessage, type WebviewMessage, type WebviewStatus } from "../protocol.js";
import { VsCodeHost, type VsCodeApi } from "./host.js";
import { readVscodeTheme } from "./theme.js";
import { installAssetWorkers, workerBlobUrl } from "./worker.js";

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;
const base = root.dataset.base ?? "";

const errors: string[] = [];
const cspViolations: string[] = [];
const log = (level: "error" | "warn", message: string): void => api.postMessage({ type: "log", level, message });
addEventListener("securitypolicyviolation", (ev) => {
  const e = ev as SecurityPolicyViolationEvent;
  const m = `${e.violatedDirective}: ${e.blockedURI}`;
  cspViolations.push(m);
  log("error", `CSP violation ${m}`);
});
addEventListener("error", (e) => {
  errors.push(e.message);
  log("error", e.message);
});
addEventListener("unhandledrejection", (e) => {
  const m = String((e.reason as Error | undefined)?.message ?? e.reason);
  errors.push(m);
  log("error", m);
});

// ---- theme: tokens are read here from the --vscode-* variables, never posted ----------------

const themeListeners = new Set<(t: ThemeTokens) => void>();
const readTheme = (): ThemeTokens => readVscodeTheme(getComputedStyle(document.documentElement), document.body.classList);
let theme = readTheme();
new MutationObserver(() => {
  // VS Code rewrites the variables and the body class together when the theme changes
  theme = readTheme();
  for (const l of themeListeners) l(theme);
}).observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-id"] });
new MutationObserver(() => {
  theme = readTheme();
  for (const l of themeListeners) l(theme);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });

// ---- designer ----------------------------------------------------------------------------

let host: VsCodeHost | undefined;
let handle: DesignerHandle | undefined;
let dispose: (() => void) | undefined;

const WASM_FILES: Record<string, string> = {
  "wasm:core": "vertep/web/wasm/core/vertep_wasm_bg.wasm",
  "wasm:journal": "vertep/web/wasm/journal/vertep_wasm_bg.wasm",
  "wasm:ecma": "vertep/ecma/wasm/vertep_wasm_bg.wasm",
};
installAssetWorkers(async (name) => {
  const file = WASM_FILES[name];
  if (!file) throw new Error(`unknown asset ${name}`);
  const res = await fetch(new URL(`${base}${file}`, location.href).href);
  if (!res.ok) throw new Error(`could not load ${file}: ${res.status}`);
  return res.arrayBuffer();
});

/** Automatic layout (not an explicit re-layout) waits out an undo or redo, see `VsCodeHost`. */
function holdDuringHistory(inner: LayoutClient, h: VsCodeHost): LayoutClient {
  return {
    layout: (model, opts) =>
      opts?.keepExisting === false || !h.historyHold
        ? inner.layout(model, opts)
        : h.historyHoldEnded().then(() => {
            throw new LayoutCancelledError("held back after undo or redo");
          }),
    cancel: () => inner.cancel(),
    dispose: () => inner.dispose(),
    get offThread() {
      return inner.offThread;
    },
  };
}

async function options(h: VsCodeHost): Promise<DesignerUiOptions> {
  const abs = (p: string): string => new URL(`${base}${p}`, location.href).href;
  const [vertepWorker, layoutWorker] = await Promise.all([workerBlobUrl(abs("vertep-worker.js")), workerBlobUrl(abs("layout-worker.js"))]);
  return {
    engine: {
      workerUrl: vertepWorker,
      // names the worker bundle resolves itself (its glue is bundled in, the wasm comes from the page)
      ecmascriptBuild: { glue: "glue:ecma", wasm: "wasm:ecma", datamodels: ["ecmascript"], journal: true },
    },
    layoutClient: holdDuringHistory(createLayoutWorker(layoutWorker), h),
  };
}

async function mount(m: Extract<HostMessage, { type: "init" }>): Promise<void> {
  dispose?.();
  root.textContent = "";
  const format = m.format ?? detectFormat(m.fileName) ?? "scxml";
  host = new VsCodeHost({
    api,
    fileName: m.fileName,
    format,
    text: m.text,
    rev: m.rev,
    ...(m.viewState ? { viewState: m.viewState } : {}),
    assetBase: base,
    theme: () => theme,
    onThemeChange: (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
  });
  const h = host;
  dispose = mountDesigner(root, h, await options(h), (d) => {
    handle = d;
  });
}

function status(): WebviewStatus {
  const model = handle?.controller.doc.model;
  const ids = model ? [...model.states.keys()] : [];
  return {
    designerMounted: handle !== undefined && root.querySelector(".vd-root") !== null,
    stateCount: ids.length,
    stateIds: ids,
    text: handle?.controller.doc.text ?? "",
    theme: theme.kind,
    runConfiguration: handle?.controller.state.run ? [...handle.controller.state.run.configuration] : null,
    validation: handle?.controller.state.validation.status ?? "none",
    cspViolations,
    errors,
  };
}

async function command(name: string): Promise<void> {
  const c = handle?.controller;
  if (!c) return;
  const sim = c.simulator;
  switch (name) {
    case "relayout":
      host?.endHistoryHold();
      await handle?.canvas()?.relayout();
      break;
    case "fit":
      handle?.canvas()?.fit();
      break;
    case "simStart":
      handle?.selectTab("simulation");
      await c.startSimulation();
      api.postMessage({ type: "simRunning", running: true });
      break;
    case "simReset":
      await c.resetSimulation();
      break;
    case "simStep":
      await sim.forward();
      break;
    case "simBack":
      await sim.back();
      break;
    case "exportSvg": {
      const svg = handle?.canvas()?.exportSvg();
      if (svg) await host?.writeFile(`${host.fileName.replace(/\.(vt\.ya?ml|scxml)$/i, "")}.svg`, svg);
      break;
    }
  }
}

addEventListener("message", (ev: MessageEvent<unknown>) => {
  const m = ev.data;
  if (!isHostMessage(m)) return;
  switch (m.type) {
    case "init":
      void mount(m).catch((e: unknown) => log("error", `mount failed: ${String((e as Error).message ?? e)}`));
      break;
    case "textChanged":
    case "ack":
      host?.receive(m);
      break;
    case "cmd":
      void command(m.name).catch((e: unknown) => log("error", String((e as Error).message ?? e)));
      break;
    case "debug":
      api.postMessage({ type: "debugState", id: m.id, state: status() } satisfies WebviewMessage);
      break;
    case "debugUndo":
      handle?.controller.undo();
      break;
    case "debugEdit":
      handle?.controller.doc.apply(m.commands as readonly Command[]);
      break;
  }
});

api.postMessage({ type: "ready" });
