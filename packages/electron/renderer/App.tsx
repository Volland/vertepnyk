/**
 * The desktop page: the web shell's designer and text pane on a `WebHost` whose file handle is
 * the preload `files` API. One document per window; the main process routes menu commands, OS
 * opens and file-watcher events here.
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { newChart, type Format } from "@vertepnyk/core";
import { createLayoutWorker } from "@vertepnyk/layout";
import { Designer, themeVars, type DesignerHandle, type DesignerUiOptions } from "@vertepnyk/designer";
import { EXAMPLES, WebHost, createThemeStore, formatOf } from "@vertepnyk/web-shell";
// not exported by the web shell's index: the shell's text pane and page styles are reused by path
import { TextPane } from "../../web-shell/src/TextPane.jsx";
import { SHELL_CSS } from "../../web-shell/src/styles.js";
import type { OpenRequest, VertepnykFiles } from "./files.js";
import { fileHandleFor, installSavePicker, type PathHandle } from "./fileHandles.js";

declare global {
  interface Window {
    vertepnykFiles?: VertepnykFiles;
    __vertepnyk?: { host: WebHost; handle: DesignerHandle | undefined; path: string | null };
  }
}

const NEXT_MODE = { auto: "light", light: "dark", dark: "auto" } as const;
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// @tg: implements:: [[openspec:electron-app#Native file handling]]
// @tg: implements:: [[openspec:electron-app#External changes are picked up]]
// @tg: implements:: [[openspec:electron-app#Multiple documents]]
// @tg: implements:: [[openspec:electron-app#Secure renderer]]
export function App(): JSX.Element {
  const files = window.vertepnykFiles!;
  const theme = createThemeStore();
  const [tokens, setTokens] = createSignal(theme.tokens());
  const [mode, setMode] = createSignal(theme.mode());
  onCleanup(theme.subscribe(setTokens));

  const [host, setHost] = createSignal<WebHost | undefined>(undefined);
  const [path, setPath] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const [showText, setShowText] = createSignal(true);
  const [message, setMessage] = createSignal<string | null>(null);

  let handle: PathHandle | undefined;
  let offStatus: (() => void) | undefined;

  const report = (): void => {
    const h = host();
    if (!h) return;
    setName(h.fileName);
    setDirty(h.dirty);
    document.title = `${h.fileName}${h.dirty ? " ●" : ""} - Vertepnyk`;
    void files.setDirty(h.dirty);
  };

  const attachPath = async (next: string | null): Promise<void> => {
    const prev = path();
    if (prev === next) return;
    if (prev) await files.unwatch(prev).catch(() => undefined);
    setPath(next);
    if (window.__vertepnyk) window.__vertepnyk.path = next;
    if (next) await files.watch(next).catch((e: Error) => setMessage(`Could not watch ${baseName(next)}: ${e.message}`));
  };

  /** Mounts a fresh host (and so a fresh simulation) on `text`. */
  const adopt = async (fileName: string, text: string, filePath: string | null): Promise<void> => {
    const format = formatOf(fileName) as Format;
    offStatus?.();
    handle = filePath ? fileHandleFor(files, filePath) : undefined;
    const h = new WebHost({ fileName, format, text, theme, base: "/", ...(handle ? { handle } : {}) });
    window.__vertepnyk = { host: h, handle: undefined, path: filePath };
    setHost(h);
    offStatus = h.onStatus(report);
    report();
    await attachPath(filePath);
  };

  const discardOk = async (): Promise<boolean> => !dirty() || files.confirm({ message: "Discard unsaved changes?", detail: "The changes in this window will be lost.", ok: "Discard", cancel: "Cancel" });

  const show = async (r: OpenRequest): Promise<void> => {
    setMessage(null);
    if (r.kind === "open") await adopt(baseName(r.path), r.text, r.path);
    else if (r.kind === "new") await adopt(r.format === "scxml" ? "untitled.scxml" : "untitled.vt.yaml", newChart(r.format, "untitled"), null);
    else await adopt(EXAMPLES[0]!.fileName, EXAMPLES[0]!.text, null);
  };

  installSavePicker(files, (p) => void attachPath(p).then(report));

  const run = async (f: () => Promise<void>): Promise<void> => {
    try {
      await f();
    } catch (e) {
      setMessage(`Could not save: ${(e as Error).message}`);
    } finally {
      report();
    }
  };

  const open = async (): Promise<void> => {
    if (!(await discardOk())) return;
    try {
      const f = await files.open();
      if (f) await adopt(baseName(f.path), f.text, f.path);
    } catch (e) {
      setMessage(`Could not open the file: ${(e as Error).message}`);
    }
  };

  onMount(() => {
    const offOpen = files.onOpenRequest((r) => void show(r));
    const offCmd = files.onCommand((c) => {
      const h = host();
      if (h) void run(() => (c === "save" ? h.save() : h.saveAs()));
    });
    // a file changed on disk: reload when clean, ask first when there are unsaved edits
    const offChange = files.onFileChanged(async (c) => {
      const h = host();
      if (!h || c.path !== path() || c.text === h.getText()) return;
      if (h.dirty) {
        const reload = await files.confirm({
          message: `${baseName(c.path)} changed on disk.`,
          detail: "Reloading discards your unsaved changes in this window.",
          ok: "Reload",
          cancel: "Keep my changes",
        });
        if (!reload) return;
      }
      if (host() === h && c.path === path()) await adopt(baseName(c.path), c.text, c.path);
    });
    onCleanup(() => {
      offOpen();
      offCmd();
      offChange();
    });
  });

  const options = (h: WebHost): DesignerUiOptions => {
    const abs = (p: string): string => new URL(h.assetUrl(p), location.href).href;
    return {
      engine: {
        workerUrl: abs("web/dist/worker.js"),
        ecmascriptBuild: { glue: abs("ecma/wasm/vertep_wasm.js"), wasm: abs("ecma/wasm/vertep_wasm_bg.wasm"), datamodels: ["ecmascript"], journal: true },
      },
      layoutClient: createLayoutWorker(),
    };
  };

  return (
    <div class="shell" style={themeVars(tokens())} data-theme={tokens().kind}>
      <style>{SHELL_CSS}</style>
      <header class="shell-header">
        <span class="shell-brand">vertepnyk</span>
        <span class="shell-file" data-testid="file-name" data-path={path() ?? ""}>
          {name()}
          <Show when={dirty()}>
            <span class="shell-dirty" title="Unsaved changes" data-testid="dirty">
              {" "}
              ●
            </span>
          </Show>
        </span>
        <span class="shell-spacer" />
        <button type="button" data-testid="open" onClick={() => void open()}>Open</button>
        <button type="button" data-testid="save" onClick={() => void run(async () => host()?.save())}>Save</button>
        <button type="button" data-testid="save-as" onClick={() => void run(async () => host()?.saveAs())}>Save as</button>
        <select
          data-testid="examples"
          aria-label="Examples"
          onChange={async (e) => {
            const sel = e.currentTarget;
            const ex = EXAMPLES.find((x) => x.id === sel.value);
            sel.value = "";
            if (ex && (await discardOk())) await adopt(ex.fileName, ex.text, null);
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
