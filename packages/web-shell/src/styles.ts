export const SHELL_CSS = `
html,body,#app{height:100%;margin:0}
body{background:var(--vt-bg)}
.shell{display:flex;flex-direction:column;height:100%;background:var(--vt-bg);color:var(--vt-fg);font-family:var(--vt-font);font-size:var(--vt-font-size);
  --shell-line:color-mix(in srgb,var(--vt-fg) 16%,var(--vt-bg))}
.shell-header{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--shell-line);background:var(--vt-fill);flex-wrap:wrap}
.shell-brand{font-weight:800;letter-spacing:.04em;margin-right:6px}
.shell-brand::before{content:"";display:inline-block;width:10px;height:10px;margin-right:8px;background:var(--vt-active);border-radius:2px;transform:rotate(45deg)}
.shell-file{font-family:var(--vt-mono);font-size:12px;color:var(--vt-muted)}
.shell-dirty{color:var(--vt-active)}
.shell-spacer{flex:1}
.shell-header button,.shell-header select{font:inherit;color:var(--vt-fg);background:transparent;border:1px solid var(--shell-line);border-radius:5px;padding:3px 10px;cursor:pointer}
.shell-header button:hover,.shell-header select:hover{background:color-mix(in srgb,var(--vt-fg) 8%,var(--vt-bg))}
.shell-header button[aria-pressed=true]{border-color:var(--vt-accent)}
.shell-header :focus-visible{outline:2px solid var(--vt-accent);outline-offset:1px}
.shell-message{padding:6px 12px;background:color-mix(in srgb,var(--vt-error) 12%,var(--vt-bg));border-bottom:1px solid var(--vt-error);cursor:pointer}
.shell-main{flex:1;display:flex;min-height:0}
.shell-textwrap{width:38%;min-width:260px;max-width:60%;border-right:1px solid var(--shell-line);min-height:0;display:flex;flex-direction:column;resize:horizontal;overflow:hidden}
.shell-text{flex:1;min-height:0;overflow:hidden}
.shell-designer{flex:1;min-width:0;min-height:0}
@media (max-width:720px){
  .shell-main{flex-direction:column}
  .shell-textwrap{width:auto;max-width:none;height:30%;border-right:0;border-bottom:1px solid var(--shell-line);resize:none}
}
`;
