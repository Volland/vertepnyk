/**
 * The page: a header with file controls, the text pane beside the designer. One `WebHost`
 * per open document; opening another document remounts the designer on a fresh host.
 */
import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { newChart, type Format } from "@vertepnyk/core";
import { createInProcessLayout } from "@vertepnyk/layout";
import { Designer, generateChart, type DesignerHandle, type DesignerUiOptions } from "@vertepnyk/designer";
import { themeVars } from "@vertepnyk/designer";
import { TextPane } from "./TextPane.jsx";
import { WebHost, formatOf, pickFile } from "./WebHost.js";
import { EXAMPLES } from "./examples.js";
import { createThemeStore, type ThemeMode } from "./theme.js";
import { SHELL_CSS } from "./styles.js";

export interface ShellGlobals {
  host: WebHost;
  handle: DesignerHandle | undefined;
}
declare global {
  interface Window {
    __vertepnyk?: ShellGlobals;
  }
}

const NEXT_MODE: Record<ThemeMode, ThemeMode> = { auto: "light", light: "dark", dark: "auto" };

// @tg: implements:: [[openspec:web-shell#Browser host]]
// @tg: implements:: [[openspec:web-shell#Side-by-side text]]
// @tg: implements:: [[openspec:web-shell#Local file access]]
export function App(): JSX.Element {
  const theme = createThemeStore();
  const [tokens, setTokens] = createSignal(theme.tokens());
  const [mode, setMode] = createSignal(theme.mode());
  onCleanup(theme.subscribe(setTokens));

  const params = new URLSearchParams(location.search);
  const bench = Number(params.get("bench") ?? 0);
  const benchMode = Number.isFinite(bench) && bench > 0;
  const example = EXAMPLES.find((e) => e.id === params.get("example")) ?? EXAMPLES[0]!;

  const make = (fileName: string, text: string, format: Format, handle?: ConstructorParameters<typeof WebHost>[0]["handle"]): WebHost =>
    new WebHost({ fileName, format, text, theme, ...(handle ? { handle } : {}) });

  const first = benchMode
    ? make(`bench-${bench}.scxml`, generateChart(bench, bench * 2), "scxml")
    : make(example.fileName, example.text, formatOf(example.fileName)!);
  const [host, setHost] = createSignal<WebHost>(first);
  const [name, setName] = createSignal(first.fileName);
  const [dirty, setDirty] = createSignal(false);
  const [showText, setShowText] = createSignal(true);
  const [message, setMessage] = createSignal<string | null>(null);

  const adopt = (h: WebHost): void => {
    setHost(h);
    setName(h.fileName);
    setDirty(h.dirty);
    h.onStatus(() => {
      setName(h.fileName);
      setDirty(h.dirty);
    });
    window.__vertepnyk = { host: h, handle: undefined };
  };
  adopt(first);

  const discardOk = (): boolean => !dirty() || confirm("Discard unsaved changes?");
  const openText = (fileName: string, text: string, handle?: Parameters<typeof make>[3]): void => {
    const format = formatOf(fileName);
    if (!format) {
      setMessage(`${fileName}: not an SCXML (.scxml) or vertep YAML (.vt.yaml) file.`);
      return;
    }
    setMessage(null);
    adopt(make(fileName, text, format, handle));
  };

  const newDoc = (format: Format): void => {
    if (!discardOk()) return;
    openText(format === "scxml" ? "untitled.scxml" : "untitled.vt.yaml", newChart(format, "untitled"));
  };
  const open = async (): Promise<void> => {
    if (!discardOk()) return;
    try {
      const f = await pickFile();
      if (f) openText(f.fileName, f.text, f.handle);
    } catch (e) {
      setMessage(`Could not open the file: ${(e as Error).message}`);
    }
  };
  const run = async (f: () => Promise<void>): Promise<void> => {
    try {
      await f();
    } catch (e) {
      setMessage(`Could not save: ${(e as Error).message}`);
    }
  };

  const options = (h: WebHost): DesignerUiOptions => {
    const abs = (p: string): string => new URL(h.assetUrl(p), location.href).href;
    return {
      engine: {
        workerUrl: abs("web/dist/worker.js"),
        ecmascriptBuild: { glue: abs("ecma/wasm/vertep_wasm.js"), wasm: abs("ecma/wasm/vertep_wasm_bg.wasm"), datamodels: ["ecmascript"], journal: true },
      },
      // a benchmark places states provisionally instead of waiting for ELK. Layout runs on the
      // page thread: elkjs's bundled build cannot start inside a module worker (its fake-worker
      // module installs itself as the worker's message handler), so `createLayoutWorker()` fails
      // in browsers.
      layoutClient: benchMode ? null : createInProcessLayout(),
    };
  };

  return (
    <div class="shell" style={themeVars(tokens())} data-theme={tokens().kind}>
      <style>{SHELL_CSS}</style>
      <header class="shell-header">
        <span class="shell-brand">vertepnyk</span>
        <span class="shell-file" data-testid="file-name">
          {name()}
          <Show when={dirty()}>
            <span class="shell-dirty" title="Unsaved changes" data-testid="dirty">
              {" "}
              ●
            </span>
          </Show>
        </span>
        <span class="shell-spacer" />
        <button type="button" data-testid="new-scxml" onClick={() => newDoc("scxml")}>New SCXML</button>
        <button type="button" data-testid="new-yaml" onClick={() => newDoc("yaml")}>New YAML</button>
        <button type="button" data-testid="open" onClick={() => void open()}>Open</button>
        <button type="button" data-testid="save" onClick={() => void run(() => host().save())}>Save</button>
        <button type="button" data-testid="save-as" onClick={() => void run(() => host().saveAs())}>Save as</button>
        <select
          data-testid="examples"
          aria-label="Examples"
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.currentTarget.value);
            e.currentTarget.value = "";
            if (ex && discardOk()) openText(ex.fileName, ex.text);
          }}
        >
          <option value="">Examples</option>
          <For each={EXAMPLES}>{(ex) => <option value={ex.id}>{ex.label}</option>}</For>
        </select>
        <button type="button" data-testid="toggle-text" aria-pressed={showText()} onClick={() => setShowText(!showText())}>Text</button>
        <button
          type="button"
          data-testid="theme"
          title="Theme: follow the system, light or dark"
          onClick={() => {
            const next = NEXT_MODE[mode()];
            theme.setMode(next);
            setMode(next);
          }}
        >
          Theme: {mode()}
        </button>
      </header>
      <Show when={message()}>
        <div class="shell-message" role="alert" data-testid="shell-message" onClick={() => setMessage(null)}>
          {message()}
        </div>
      </Show>
      <main class="shell-main">
        <Show when={host()} keyed>
          {(h) => (
            <>
              <Show when={showText()}>
                <section class="shell-textwrap" aria-label="Chart text">
                  <TextPane host={h} theme={tokens} />
                </section>
              </Show>
              <section class="shell-designer" aria-label="Designer">
                <Designer
                  host={h}
                  options={options(h)}
                  onReady={(handle) => {
                    if (window.__vertepnyk?.host === h) window.__vertepnyk.handle = handle;
                  }}
                />
              </section>
            </>
          )}
        </Show>
      </main>
    </div>
  );
}
