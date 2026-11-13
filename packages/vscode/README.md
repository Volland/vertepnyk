# Vertepnyk for VS Code

A visual designer and simulator for [vertep](https://github.com/Volland/vertep) statecharts, inside VS Code.

- Open `*.scxml`, `*.vt.yaml` and `*.vt.yml` files in a canvas designer (right-click a file, **Open With... > Vertepnyk Designer**, or set `vertepnyk.defaultEditor` to `designer`).
- Edit visually: every change is a normal text edit on the file, so undo, redo, save, auto-save, hot exit and source-control diff all work.
- Open the text editor beside the designer; edits in either show in the other.
- Validation problems appear in the Problems panel; selecting one reveals the element.
- Simulate the chart with vertep's own engine (WebAssembly, offline): step, step back, time-travel, fork.
- Commands: New SCXML/YAML Chart, Open in Designer, Open Text Editor to the Side, Re-layout, Start/Reset/Step simulation, Export Canvas as SVG.

Everything runs locally; the extension makes no network requests.

Licensed under MIT OR Apache-2.0.

## Security

The designer webview runs under this content security policy and loads nothing from the network:

```
default-src 'none'; img-src <extension> data: blob:; font-src <extension>;
style-src <extension> 'unsafe-inline'; script-src 'nonce-...' <extension> 'wasm-unsafe-eval';
worker-src <extension> blob:; connect-src <extension>
```

`'wasm-unsafe-eval'` lets vertep's WebAssembly engine compile; `<extension>` is the webview origin of this extension's own folder; `'unsafe-inline'` is for styles only (the designer injects `<style>` elements).
