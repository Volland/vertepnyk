/** A read-only chart canvas for notes (code blocks and embeds), following Obsidian's theme. */
import { Show, createSignal, onCleanup, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { Canvas, themeVars, type CanvasApi } from "@vertepnyk/canvas";
import { ChartDocument, type Format } from "@vertepnyk/core";
import type { LayoutClient } from "@vertepnyk/layout";
import type { ThemeSource } from "./theme.js";

export interface ReadOnlyChartProps {
  text: string;
  format: Format;
  theme: ThemeSource;
  layoutClient?: LayoutClient;
  apiRef?: (api: CanvasApi) => void;
}

export function ReadOnlyChart(props: ReadOnlyChartProps): JSX.Element {
  const doc = ChartDocument.open(props.text, props.format);
  let api: CanvasApi | undefined;
  let fitted = false;
  // fit the chart into the block once the first layout has placed its states
  const client: LayoutClient | undefined = props.layoutClient && {
    get offThread() {
      return props.layoutClient!.offThread;
    },
    cancel: () => props.layoutClient!.cancel(),
    dispose: () => props.layoutClient!.dispose(),
    async layout(model, opts) {
      const r = await props.layoutClient!.layout(model, opts);
      if (!fitted) {
        fitted = true;
        setTimeout(() => api?.fit(), 50);
      }
      return r;
    },
  };
  const [tokens, setTokens] = createSignal(props.theme.tokens());
  onCleanup(props.theme.subscribe(setTokens));
  return (
    <div class="vertepnyk-canvas vd-root" style={themeVars(tokens())} data-theme={tokens().kind}>
      <Show
        when={doc.model}
        fallback={
          <div class="vertepnyk-error" role="alert" data-testid="chart-error">
            Does not parse{doc.error ? ` at ${doc.error.line}:${doc.error.column}: ${doc.error.message}` : ""}
          </div>
        }
      >
        <Canvas
          doc={doc}
          theme={tokens()}
          readOnly
          toolbar={false}
          {...(client ? { layoutClient: client } : {})}
          apiRef={(a) => {
            api = a;
            props.apiRef?.(a);
            // charts with a stored layout never ask for one: fit as soon as the canvas is laid out
            setTimeout(() => api?.fit(), 0);
          }}
        />
      </Show>
    </div>
  );
}

/** Mounts a read-only chart into `el`; returns a disposer. */
export function mountReadOnlyChart(el: HTMLElement, props: ReadOnlyChartProps): () => void {
  return render(() => <ReadOnlyChart {...props} />, el);
}
