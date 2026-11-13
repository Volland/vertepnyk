import type { ThemeTokens } from "@vertepnyk/host-bridge";

/** The theme tokens as CSS custom properties. */
export function themeVars(t: ThemeTokens): string {
  return [
    `--vt-bg:${t.background}`,
    `--vt-fg:${t.foreground}`,
    `--vt-muted:${t.muted}`,
    `--vt-fill:${t.stateFill}`,
    `--vt-border:${t.stateBorder}`,
    `--vt-accent:${t.accent}`,
    `--vt-active:${t.active}`,
    `--vt-error:${t.error}`,
    `--vt-warning:${t.warning}`,
    `--vt-font:${t.fontFamily}`,
    `--vt-font-size:${t.fontSize}`,
    `--vt-mono:${t.monoFontFamily}`,
  ].join(";");
}

/** Static stylesheet; all colours and fonts come from the `--vt-*` properties. */
export const CANVAS_CSS = `
.vt-root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--vt-bg);color:var(--vt-fg);font-family:var(--vt-font);font-size:var(--vt-font-size)}
.vt-svg{display:block;width:100%;height:100%;background:var(--vt-bg);user-select:none;touch-action:none;outline:none;cursor:default}
.vt-svg.vt-panning{cursor:grab}
.vt-state{outline:none}
.vt-box{fill:var(--vt-fill);stroke:var(--vt-border);stroke-width:1.5}
.vt-state[data-kind=compound]>.vt-box,.vt-state[data-kind=parallel]>.vt-box{fill-opacity:.55}
.vt-state[data-kind=final]>.vt-inner{fill:none;stroke:var(--vt-border);stroke-width:1.5}
.vt-state[data-kind=history]>.vt-box{fill:var(--vt-fill)}
.vt-state[data-kind=parallel]>.vt-box{stroke-width:2}
.vt-header{stroke:var(--vt-border);stroke-width:1;fill:none}
.vt-sep{stroke:var(--vt-muted);stroke-width:1.5;stroke-dasharray:7 5;fill:none}
.vt-name{fill:var(--vt-fg);pointer-events:none}
.vt-state[data-kind=compound] .vt-name,.vt-state[data-kind=parallel] .vt-name{font-weight:600}
.vt-tag{fill:var(--vt-muted);font-size:11px;pointer-events:none}
.vt-hist{fill:var(--vt-fg);font-weight:700;pointer-events:none;text-anchor:middle}
.vt-toggle{cursor:pointer}
.vt-toggle text{fill:var(--vt-muted);text-anchor:middle;font-weight:700}
.vt-state[data-active=true]>.vt-box{stroke:var(--vt-active);stroke-width:3;fill:color-mix(in srgb,var(--vt-active) 14%,var(--vt-fill))}
.vt-state[data-severity=warning]>.vt-box{stroke:var(--vt-warning);stroke-width:2.5}
.vt-state[data-severity=error]>.vt-box{stroke:var(--vt-error);stroke-width:2.5}
.vt-state[data-selected=true]>.vt-box{stroke:var(--vt-accent);stroke-width:2.5}
.vt-state:focus>.vt-box,.vt-state:focus-visible>.vt-box{stroke:var(--vt-accent);stroke-width:3.5;stroke-dasharray:none}
.vt-state[data-drop-target=true]>.vt-box{stroke:var(--vt-accent);stroke-dasharray:6 4;stroke-width:3}
.vt-state[data-provisional=true]>.vt-box{stroke-dasharray:3 3}
.vt-port{fill:var(--vt-accent);stroke:var(--vt-bg);stroke-width:2;cursor:crosshair}
.vt-resize{fill:var(--vt-accent);cursor:nwse-resize}
.vt-internal{fill:var(--vt-muted);font-family:var(--vt-mono);font-size:11px;cursor:pointer}
.vt-internal-g[data-selected=true] .vt-internal,.vt-internal-g:focus .vt-internal{fill:var(--vt-accent);font-weight:700}
.vt-internal-g{outline:none}
.vt-internal-g[data-taken=true] .vt-internal{fill:var(--vt-active)}
.vt-edge{outline:none}
.vt-line{fill:none;stroke:var(--vt-muted);stroke-width:1.5}
.vt-edge[data-eventless=true] .vt-line{stroke-dasharray:6 4}
.vt-hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
.vt-label{fill:var(--vt-fg);font-size:11px;font-family:var(--vt-mono);text-anchor:middle;paint-order:stroke;stroke:var(--vt-bg);stroke-width:3px;stroke-linejoin:round;cursor:pointer}
.vt-edge[data-taken=true] .vt-line{stroke:var(--vt-active);stroke-width:3}
.vt-edge[data-severity=warning] .vt-line{stroke:var(--vt-warning)}
.vt-edge[data-severity=error] .vt-line{stroke:var(--vt-error)}
.vt-edge[data-selected=true] .vt-line,.vt-edge:focus .vt-line{stroke:var(--vt-accent);stroke-width:2.5}
.vt-edge:focus .vt-label{font-weight:700}
.vt-end{fill:var(--vt-accent);stroke:var(--vt-bg);stroke-width:2;cursor:move}
.vt-initial-dot{fill:var(--vt-fg)}
.vt-initial-line{fill:none;stroke:var(--vt-fg);stroke-width:1.5}
.vt-marker-n path{fill:var(--vt-muted)}
.vt-marker-sel path{fill:var(--vt-accent)}
.vt-marker-act path{fill:var(--vt-active)}
.vt-marker-err path{fill:var(--vt-error)}
.vt-marker-ini path{fill:var(--vt-fg)}
.vt-draft{fill:none;stroke:var(--vt-accent);stroke-width:2;stroke-dasharray:5 4;pointer-events:none}
.vt-marquee{fill:var(--vt-accent);fill-opacity:.12;stroke:var(--vt-accent);stroke-dasharray:4 3;pointer-events:none}
.vt-toolbar{position:absolute;top:8px;left:8px;display:flex;gap:4px;padding:4px;background:var(--vt-fill);border:1px solid var(--vt-border);border-radius:6px}
.vt-toolbar button{font:inherit;color:var(--vt-fg);background:transparent;border:1px solid transparent;border-radius:4px;padding:2px 8px;cursor:pointer}
.vt-toolbar button:hover,.vt-toolbar button:focus-visible{border-color:var(--vt-accent)}
.vt-menu{position:absolute;display:flex;flex-direction:column;min-width:160px;padding:4px;background:var(--vt-fill);border:1px solid var(--vt-border);border-radius:6px;z-index:3}
.vt-menu button{font:inherit;text-align:left;color:var(--vt-fg);background:transparent;border:0;border-radius:4px;padding:4px 8px;cursor:pointer}
.vt-menu button:hover,.vt-menu button:focus-visible{background:var(--vt-accent);color:var(--vt-bg)}
.vt-rename{position:absolute;z-index:4;font:inherit;color:var(--vt-fg);background:var(--vt-fill);border:2px solid var(--vt-accent);border-radius:4px;padding:2px 6px;box-sizing:border-box}
.vt-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
