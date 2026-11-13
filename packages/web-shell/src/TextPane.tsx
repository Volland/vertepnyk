/**
 * The text pane: a CodeMirror 6 editor on the host's buffer. Typing goes to the host as an
 * external change; the designer's edits arrive as patches and are applied to the editor as the
 * same minimal changes, so the cursor and scroll position stay put.
 */
import { createEffect, onCleanup, onMount, type JSX } from "solid-js";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { ThemeTokens } from "@vertepnyk/host-bridge";
import type { BufferChange, WebHost } from "./WebHost.js";

const chrome = (dark: boolean) =>
  EditorView.theme(
    {
      "&": { height: "100%", color: "var(--vt-fg)", backgroundColor: "var(--vt-bg)", fontSize: "12.5px" },
      ".cm-scroller": { fontFamily: "var(--vt-mono)", lineHeight: "1.55" },
      ".cm-gutters": { backgroundColor: "var(--vt-bg)", color: "var(--vt-muted)", border: "none" },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--vt-fg) 6%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--vt-fg)" },
      ".cm-cursor": { borderLeftColor: "var(--vt-fg)" },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in srgb, var(--vt-active) 28%, transparent)",
      },
    },
    { dark },
  );

export function TextPane(props: { host: WebHost; theme: () => ThemeTokens }): JSX.Element {
  let parent!: HTMLDivElement;
  let view: EditorView | undefined;
  const themeSlot = new Compartment();

  onMount(() => {
    const host = props.host;
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: host.getText(),
        extensions: [
          basicSetup,
          EditorView.lineWrapping,
          host.format === "scxml" ? xml() : yaml(),
          themeSlot.of(chrome(props.theme().kind !== "light")),
          EditorView.contentAttributes.of({ "aria-label": `${host.fileName} text` }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(Transaction.remote))) return;
            host.setExternalText(u.state.doc.toString());
          }),
        ],
      }),
    });

    const apply = (c: BufferChange): void => {
      const v = view!;
      if (v.state.doc.toString() === c.text) return;
      const changes = c.patches
        ? c.patches.map((p) => ({ from: p.start, to: p.end, insert: p.text }))
        : { from: 0, to: v.state.doc.length, insert: c.text };
      try {
        v.dispatch({ changes, annotations: Transaction.remote.of(true) });
      } catch {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c.text }, annotations: Transaction.remote.of(true) });
      }
      if (v.state.doc.toString() !== c.text) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c.text }, annotations: Transaction.remote.of(true) });
      }
    };
    const offBuffer = host.onDidChangeBuffer(apply);
    const offReveal = host.onRevealText((s) => {
      const len = view!.state.doc.length;
      const from = Math.min(s.start, len);
      const to = Math.min(Math.max(s.end, from), len);
      view!.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    });
    onCleanup(() => {
      offBuffer();
      offReveal();
      view?.destroy();
    });
  });

  createEffect(() => {
    const dark = props.theme().kind !== "light";
    view?.dispatch({ effects: themeSlot.reconfigure(chrome(dark)) });
  });

  return (
    <div
      class="shell-text"
      ref={parent}
      data-testid="text-pane"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void props.host.save();
        }
      }}
    />
  );
}
