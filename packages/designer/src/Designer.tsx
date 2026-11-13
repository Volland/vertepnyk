/**
 * The designer: toolbar, canvas, and a tabbed side panel (Inspector, Simulation, Problems) on
 * one `DesignerController`. Everything it needs from its surroundings comes through the host.
 */
import { Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";
import type { Span } from "@vertepnyk/core";
import { Canvas, themeVars, type CanvasApi, type Viewport } from "@vertepnyk/canvas";
import { Inspector, type CheckExpression } from "@vertepnyk/inspector";
import { createLayoutWorker, type LayoutClient } from "@vertepnyk/layout";
import type { HostBridge, ThemeTokens } from "@vertepnyk/host-bridge";
import { DesignerController, type DesignerOptions, type DesignerState } from "./controller.js";
import { SimulationPanel } from "./SimulationPanel.jsx";
import { ProblemsPanel } from "./ProblemsPanel.jsx";
import { canvasDiagnostics, offsetAt, problemsOf, type ProblemItem } from "./problems.js";
import { DESIGNER_CSS } from "./styles.js";

export interface DesignerUiOptions extends DesignerOptions {
  /** Layout client for states without a stored layout; `null` places them provisionally. Default: a worker. */
  layoutClient?: LayoutClient | null;
}

export type TabId = "inspector" | "simulation" | "problems";

/** Handles the embedding page may use (and tests drive). */
export interface DesignerHandle {
  readonly controller: DesignerController;
  readonly canvas: () => CanvasApi | undefined;
  /** Highlights `ids` as active regardless of any run (benchmarks); `null` returns to the run. */
  setActiveOverride(ids: readonly string[] | null): void;
  selectTab(tab: TabId): void;
}

export interface DesignerProps {
  host: HostBridge;
  options?: DesignerUiOptions;
  onReady?: (handle: DesignerHandle) => void;
}

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "inspector", label: "Inspector" },
  { id: "simulation", label: "Simulation" },
  { id: "problems", label: "Problems" },
];

// @tg: implements:: [[openspec:chart-simulation#Active configuration is highlighted]]
// @tg: implements:: [[openspec:chart-validation#Diagnostics are located]]
// @tg: implements:: [[openspec:chart-validation#Content hash shown]]
export function Designer(props: DesignerProps): JSX.Element {
  const host = props.host;
  const { layoutClient: layoutOption, ...controllerOptions } = props.options ?? {};
  const ctl = new DesignerController(host, controllerOptions);
  const layoutClient = layoutOption === null ? undefined : (layoutOption ?? createLayoutWorker());

  const [state, setState] = createSignal<DesignerState>(ctl.state, { equals: false });
  const unsub = ctl.subscribe((s) => setState(s));
  const [theme, setTheme] = createSignal<ThemeTokens>(host.theme());
  const offTheme = host.onThemeChange((t) => setTheme(t));

  const saved = (host.getViewState() ?? {}) as { viewport?: Viewport; tab?: TabId };
  const [tab, setTab] = createSignal<TabId>(TABS.some((t) => t.id === saved.tab) ? (saved.tab as TabId) : "inspector");
  const [selection, setSelection] = createSignal<readonly string[]>([]);
  const [override, setOverride] = createSignal<ReadonlySet<string> | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  let api: CanvasApi | undefined;
  let viewport: Viewport | undefined = saved.viewport;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => host.setViewState({ viewport, tab: tab() }), 250);
  };
  createEffect(() => {
    tab();
    persist();
  });

  onCleanup(() => {
    clearTimeout(saveTimer);
    unsub();
    offTheme();
    layoutClient?.dispose();
    ctl.dispose();
  });

  const problems = createMemo<ProblemItem[]>(() => problemsOf(state(), ctl.doc.text));
  const diagnostics = createMemo(() => canvasDiagnostics(problems()));
  const active = createMemo<ReadonlySet<string>>(() => {
    const o = override();
    if (o) return o;
    const r = state().run;
    if (!r) return new Set();
    return new Set(r.configuration.length > 0 ? r.configuration : r.finalStates);
  });
  const taken = createMemo<ReadonlySet<string>>(() => new Set(state().run?.transitions.map((t) => t.id) ?? []));
  const readOnly = () => host.readOnly || state().parseError !== null;

  const reveal = (span: Span): void => host.revealText?.(span);
  const revealElement = (id: string): void => {
    const m = ctl.doc.model;
    const span = m?.states.get(id)?.span ?? m?.transitions.get(id)?.span;
    if (span) reveal(span);
  };

  // @tg: implements:: [[openspec:chart-validation#Diagnostics are located]]
  const selectProblem = (p: ProblemItem): void => {
    if (p.elementId !== undefined) {
      setSelection([p.elementId]);
      api?.centerOn(p.elementId);
    }
    if (p.line !== undefined) {
      const at = offsetAt(ctl.doc.text, p.line, p.column ?? 1);
      reveal({ start: at, end: at });
    }
  };

  const checkExpression: CheckExpression = async (req) => {
    const hit = problems().find((p) => p.source === "vertep" && p.elementId === req.ownerId);
    return hit ? { message: hit.message } : null;
  };

  const exportSvg = async (): Promise<void> => {
    if (!api || !host.writeFile) return;
    const base = host.fileName.replace(/\.(vt\.ya?ml|scxml)$/i, "");
    try {
      await host.writeFile(`${base}.svg`, api.exportSvg());
    } catch (e) {
      setNotice(`Export failed: ${(e as Error).message}`);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const editing = t !== null && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void host.save();
    } else if (key === "z" && !editing) {
      e.preventDefault();
      if (e.shiftKey) ctl.redo();
      else ctl.undo();
    } else if (key === "y" && !editing) {
      e.preventDefault();
      ctl.redo();
    }
  };

  const validation = () => state().validation;
  const version = () => {
    const v = validation();
    return v.status === "valid" ? v.version : undefined;
  };

  onMount(() => {
    props.onReady?.({
      controller: ctl,
      canvas: () => api,
      setActiveOverride: (ids) => setOverride(ids ? new Set(ids) : null),
      selectTab: (t) => setTab(t),
    });
  });

  return (
    <div class="vd-root" style={themeVars(theme())} data-theme={theme().kind} onKeyDown={onKey}>
      <style>{DESIGNER_CSS}</style>
      <div class="vd-toolbar" role="toolbar" aria-label="Designer">
        <button type="button" class="vd-btn" data-testid="undo" disabled={!state().canUndo || readOnly()} onClick={() => ctl.undo()} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button type="button" class="vd-btn" data-testid="redo" disabled={!state().canRedo || readOnly()} onClick={() => ctl.redo()} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
        <span class="vd-sep" />
        <button
          type="button"
          class="vd-btn vd-primary"
          data-testid="toolbar-simulate"
          disabled={state().parseError !== null}
          onClick={() => {
            setTab("simulation");
            void ctl.startSimulation().then((r) => {
              if (!r.ok) setTab("problems");
            });
          }}
        >
          {state().run ? "Restart" : "Simulate"}
        </button>
        <Show when={state().run}>
          <button type="button" class="vd-btn" data-testid="toolbar-reset" onClick={() => void ctl.resetSimulation()}>
            Reset
          </button>
          <Show when={state().runStale}>
            <button type="button" class="vd-btn" data-testid="toolbar-replay" onClick={() => void ctl.replaySimulation()}>
              Replay
            </button>
          </Show>
        </Show>
        <span class="vd-sep" />
        <button type="button" class="vd-btn" data-testid="relayout" disabled={readOnly() || !layoutClient} onClick={() => void api?.relayout()}>
          Relayout
        </button>
        <button type="button" class="vd-btn" data-testid="fit" onClick={() => api?.fit()}>
          Fit
        </button>
        <Show when={host.writeFile}>
          <button type="button" class="vd-btn" data-testid="export-svg" onClick={() => void exportSvg()}>
            Export SVG
          </button>
        </Show>
        <span class="vd-spacer" />
        <Show when={host.readOnly}>
          <span class="vd-readonly">read-only</span>
        </Show>
        <span class="vd-badge" data-testid="version-badge" data-status={validation().status} title={version() ?? validation().status}>
          {version() ? version()!.replace(/^urn:vertep:chart:/, "") : validation().status === "invalid" ? "invalid" : validation().status === "unparseable" ? "unparseable" : "checking"}
        </span>
      </div>

      <Show when={state().parseError}>
        {(e) => (
          <div class="vd-banner vd-err vd-parse" role="alert" data-testid="parse-error">
            Does not parse at {e().line}:{e().column}. {e().message}
          </div>
        )}
      </Show>
      <Show when={notice()}>
        <div class="vd-banner vd-warn vd-parse" role="status" data-testid="notice" onClick={() => setNotice(null)}>
          {notice()}
        </div>
      </Show>

      <div class="vd-main">
        <div class="vd-canvas" data-testid="canvas-pane">
          <Canvas
            doc={ctl.doc}
            theme={theme()}
            layoutClient={layoutClient}
            active={active()}
            taken={taken()}
            diagnostics={diagnostics()}
            readOnly={readOnly()}
            selection={selection()}
            onSelectionChange={(ids) => setSelection(ids)}
            viewport={saved.viewport}
            onViewportChange={(v) => {
              viewport = v;
              persist();
            }}
            onRevealRequest={revealElement}
            onError={(m) => setNotice(m)}
            apiRef={(a) => (api = a)}
          />
        </div>
        <aside class="vd-side" aria-label="Side panel">
          <div class="vd-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                type="button"
                role="tab"
                class="vd-tab"
                id={`vd-tab-${t.id}`}
                data-testid={`tab-${t.id}`}
                aria-selected={tab() === t.id}
                aria-controls={`vd-tabpanel-${t.id}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <Show when={t.id === "problems" && problems().length > 0}>
                  <span class="vd-count" data-testid="problem-count">{problems().length}</span>
                </Show>
              </button>
            ))}
          </div>
          <div class="vd-tabpanel" role="tabpanel" id={`vd-tabpanel-${tab()}`} aria-labelledby={`vd-tab-${tab()}`}>
            <Show when={tab() === "inspector"}>
              <div class="vd-inspector">
                <Inspector
                  doc={ctl.doc}
                  selection={selection()}
                  theme={theme()}
                  checkExpression={checkExpression}
                  onRevealText={reveal}
                  onError={(e) => setNotice(e.message)}
                  onSelect={(ids) => batch(() => setSelection(ids))}
                />
              </div>
            </Show>
            <Show when={tab() === "simulation"}>
              <SimulationPanel controller={ctl} state={state} onStartRefused={() => setTab("problems")} />
            </Show>
            <Show when={tab() === "problems"}>
              <ProblemsPanel items={problems()} validation={validation().status} onSelect={selectProblem} />
            </Show>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Mounts the designer into `el`; returns a disposer. */
export function mountDesigner(el: HTMLElement, host: HostBridge, options?: DesignerUiOptions, onReady?: (h: DesignerHandle) => void): () => void {
  return render(() => <Designer host={host} {...(options ? { options } : {})} {...(onReady ? { onReady } : {})} />, el);
}
