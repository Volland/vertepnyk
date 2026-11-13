/** Designer chrome, driven only by the host's theme tokens (`--vt-*`, set from `ThemeTokens`). */
export const DESIGNER_CSS = `
.vd-root{container-type:inline-size;container-name:vd;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--vt-bg);color:var(--vt-fg);font-family:var(--vt-font);font-size:var(--vt-font-size);
  --vd-line:color-mix(in srgb,var(--vt-fg) 16%,var(--vt-bg));--vd-soft:color-mix(in srgb,var(--vt-fg) 5%,var(--vt-bg));--vd-hover:color-mix(in srgb,var(--vt-fg) 9%,var(--vt-bg))}
.vd-root *{box-sizing:border-box}
.vd-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid var(--vd-line);background:var(--vt-fill)}
.vd-toolbar .vd-sep{width:1px;align-self:stretch;background:var(--vd-line);margin:0 4px}
.vd-spacer{flex:1}
.vd-badge{font-family:var(--vt-mono);font-size:11px;color:var(--vt-muted);border:1px solid var(--vd-line);border-radius:999px;padding:2px 8px;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vd-badge[data-status=valid]{color:var(--vt-fg)}
.vd-badge[data-status=invalid]{color:var(--vt-error);border-color:var(--vt-error)}
.vd-btn{font:inherit;color:var(--vt-fg);background:transparent;border:1px solid var(--vd-line);border-radius:5px;padding:3px 10px;cursor:pointer}
.vd-btn:hover:not(:disabled){background:var(--vd-hover)}
.vd-btn:focus-visible,.vd-input:focus-visible,.vd-tab:focus-visible,.vd-chip-btn:focus-visible,.vd-problem:focus-visible,.vd-logbtn:focus-visible{outline:2px solid var(--vt-accent);outline-offset:1px}
.vd-btn:disabled{opacity:.45;cursor:default}
.vd-btn.vd-primary{background:var(--vt-accent);border-color:var(--vt-accent);color:var(--vt-bg)}
.vd-btn.vd-primary:hover:not(:disabled){background:color-mix(in srgb,var(--vt-accent) 85%,var(--vt-fg))}
.vd-main{flex:1;display:flex;min-height:0}
.vd-canvas{flex:1;min-width:0;position:relative}
.vd-side{width:340px;max-width:45%;display:flex;flex-direction:column;border-left:1px solid var(--vd-line);background:var(--vt-bg);min-height:0}
.vd-tabs{display:flex;border-bottom:1px solid var(--vd-line)}
.vd-tab{font:inherit;flex:1;color:var(--vt-muted);background:transparent;border:0;border-bottom:2px solid transparent;padding:8px 6px;cursor:pointer}
.vd-tab[aria-selected=true]{color:var(--vt-fg);border-bottom-color:var(--vt-accent);font-weight:600}
.vd-count{display:inline-block;min-width:16px;margin-left:5px;padding:0 5px;border-radius:999px;background:var(--vt-error);color:var(--vt-bg);font-size:10px;line-height:16px}
.vd-tabpanel{flex:1;overflow:auto;min-height:0}
.vd-panel{padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.vd-row{display:flex;gap:6px;align-items:center}
.vd-sect h3{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--vt-muted);display:flex;gap:8px;align-items:center;justify-content:space-between}
.vd-hint,.vd-muted{color:var(--vt-muted)}
.vd-hint{margin:0}
.vd-mono{font-family:var(--vt-mono);font-size:12px}
.vd-banner{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:7px 10px;border-radius:6px;border:1px solid var(--vd-line);background:var(--vd-soft)}
.vd-banner.vd-warn{border-color:var(--vt-warning);background:color-mix(in srgb,var(--vt-warning) 12%,var(--vt-bg))}
.vd-banner.vd-err{border-color:var(--vt-error);background:color-mix(in srgb,var(--vt-error) 10%,var(--vt-bg));white-space:pre-wrap}
.vd-banner.vd-ok{border-color:var(--vt-active);background:color-mix(in srgb,var(--vt-active) 12%,var(--vt-bg));justify-content:flex-start;display:block}
.vd-parse{border-radius:0;border-width:0 0 1px;justify-content:flex-start}
.vd-chips{display:flex;flex-wrap:wrap;gap:5px}
.vd-chip{font-family:var(--vt-mono);font-size:12px;border:1px solid var(--vd-line);border-radius:999px;padding:2px 9px;background:var(--vt-fill);color:var(--vt-fg)}
.vd-chip-active{border-color:var(--vt-active);background:color-mix(in srgb,var(--vt-active) 18%,var(--vt-fill))}
.vd-chip-btn{cursor:pointer}
.vd-chip-btn:hover:not(:disabled){border-color:var(--vt-accent)}
.vd-chip-btn:disabled{opacity:.5;cursor:default}
.vd-form{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.vd-input{font:inherit;color:var(--vt-fg);background:var(--vt-fill);border:1px solid var(--vd-line);border-radius:5px;padding:4px 7px;width:100%}
textarea.vd-input{resize:vertical}
.vd-select{font:inherit;font-size:11px;text-transform:none;letter-spacing:0;color:var(--vt-fg);background:var(--vt-fill);border:1px solid var(--vd-line);border-radius:4px}
.vd-slider{flex:1;accent-color:var(--vt-accent)}
.vd-ctxrow{display:grid;grid-template-columns:minmax(0,auto) 1fr auto;gap:8px;padding:3px 0;border-bottom:1px solid var(--vd-line)}
.vd-ctxkey{color:var(--vt-muted)}
.vd-ctxval{word-break:break-all}
.vd-flag{font-size:11px;color:var(--vt-active);white-space:nowrap}
.vd-ctxrow.vd-changed .vd-ctxval{color:var(--vt-active);font-weight:700}
.vd-log{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.vd-log li{border-left:2px solid var(--vd-line);padding:2px 0 6px 10px}
.vd-log li.vd-current{border-left-color:var(--vt-active)}
.vd-logbtn{font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer;display:flex;gap:8px;text-align:left}
.vd-step{color:var(--vt-muted);min-width:1.5em}
.vd-ev{font-weight:600}
.vd-logdetail{font-size:12px;padding-left:calc(1.5em + 8px)}
.vd-internal{color:var(--vt-accent)}
.vd-problems{list-style:none;margin:0;padding:0}
.vd-problem{font:inherit;color:inherit;display:grid;grid-template-columns:18px 1fr;gap:2px 8px;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid var(--vd-line);padding:8px 12px;cursor:pointer}
.vd-problem:hover{background:var(--vd-hover)}
.vd-sev{grid-row:1/3;width:16px;height:16px;border-radius:50%;background:var(--vt-error);color:var(--vt-bg);font-size:10px;font-weight:700;text-align:center;line-height:16px}
.vd-problem[data-severity=warning] .vd-sev{background:var(--vt-warning)}
.vd-pmsg{word-break:break-word}
.vd-ploc{color:var(--vt-muted)}
.vd-inspector{height:100%}
.vd-readonly{font-size:11px;color:var(--vt-muted)}
@container vd (max-width:720px){
  .vd-main{flex-direction:column}
  .vd-side{width:auto;max-width:none;height:46%;border-left:0;border-top:1px solid var(--vd-line)}
}
`;
