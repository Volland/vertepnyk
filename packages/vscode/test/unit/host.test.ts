import { describe, expect, it } from "vitest";
import { LIGHT_THEME } from "@vertepnyk/host-bridge";
import { VsCodeHost, type VsCodeApi } from "../../src/webview/host.js";
import type { HostMessage, WebviewMessage } from "../../src/protocol.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(text = "abc", rev = 1) {
  const sent: WebviewMessage[] = [];
  let stored: unknown;
  const api: VsCodeApi = { postMessage: (m) => sent.push(m), getState: () => stored, setState: (s) => (stored = s) };
  const host = new VsCodeHost({ api, fileName: "order.scxml", format: "scxml", text, rev, assetBase: "https://res.test/dist/", theme: () => LIGHT_THEME, onThemeChange: () => () => {} });
  const patches = () => sent.filter((m): m is Extract<WebviewMessage, { type: "patches" }> => m.type === "patches");
  return { host, sent, patches, api, state: () => stored };
}

describe("VsCodeHost buffer", () => {
  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: unit}
  it("sends one patches message with the revision it read and applies the text on ack", async () => {
    const { host, patches } = setup("abc", 4);
    const done = host.applyPatches([{ start: 1, end: 2, text: "XY" }], "edit");
    await tick();
    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({ rev: 4, label: "edit", patches: [{ start: 1, end: 2, text: "XY" }] });
    host.receive({ type: "ack", id: patches()[0]!.id, ok: true, rev: 5 });
    await expect(done).resolves.toBe(true);
    expect(host.getText()).toBe("aXYc");
    expect(host.rev).toBe(5);
  });

  // @tg: verifies:: [[openspec:vscode-extension#Text and visual toggle#Side by side]] {level: unit}
  it("on a refusal adopts the host text and resolves false so the designer re-reads", async () => {
    const { host, patches } = setup("abc", 4);
    const done = host.applyPatches([{ start: 0, end: 0, text: "Z" }], "edit");
    await tick();
    host.receive({ type: "ack", id: patches()[0]!.id, ok: false, rev: 6, text: "typed meanwhile" });
    await expect(done).resolves.toBe(false);
    expect(host.getText()).toBe("typed meanwhile");
    expect(host.rev).toBe(6);
  });

  it("serialises edits: the second is sent only after the first ack, against the new revision", async () => {
    const { host, patches } = setup("abc", 1);
    const a = host.applyPatches([{ start: 3, end: 3, text: "d" }], "1");
    const b = host.applyPatches([{ start: 4, end: 4, text: "e" }], "2");
    await tick();
    expect(patches()).toHaveLength(1);
    host.receive({ type: "ack", id: patches()[0]!.id, ok: true, rev: 2 });
    await a;
    await tick();
    expect(patches()).toHaveLength(2);
    expect(patches()[1]!.rev).toBe(2);
    host.receive({ type: "ack", id: patches()[1]!.id, ok: true, rev: 3 });
    await b;
    expect(host.getText()).toBe("abcde");
  });

  // @tg: verifies:: [[openspec:vscode-extension#Text and visual toggle#Side by side]] {level: unit}
  it("tells the designer about text changes made elsewhere, and ignores identical text", () => {
    const { host } = setup("abc", 1);
    const seen: string[] = [];
    host.onDidChangeText((t) => seen.push(t));
    host.receive({ type: "textChanged", text: "abcd", rev: 2 } satisfies HostMessage);
    host.receive({ type: "textChanged", text: "abcd", rev: 3 });
    expect(seen).toEqual(["abcd"]);
    expect(host.rev).toBe(3);
  });

  // @tg: verifies:: [[openspec:vscode-extension#Native undo and save#Undo through VS Code]] {level: unit}
  it("delegates undo, redo and save to VS Code and declares native undo", () => {
    const { host, sent } = setup();
    expect(host.capabilities.nativeUndo).toBe(true);
    host.undo();
    host.redo();
    void host.save();
    expect(sent.map((m) => m.type)).toEqual(["undo", "redo", "save"]);
  });
});

describe("VsCodeHost view state, diagnostics and assets", () => {
  // @tg: verifies:: [[openspec:host-bridge#Host persists view state#Viewport restored]] {level: unit}
  it("posts view state to the host and keeps it in the webview state", () => {
    const { host, sent, state } = setup();
    host.setViewState({ viewport: { x: 1, y: 2, zoom: 3 } });
    expect(sent.at(-1)).toEqual({ type: "viewState", state: { viewport: { x: 1, y: 2, zoom: 3 } } });
    expect(state()).toEqual({ view: { viewport: { x: 1, y: 2, zoom: 3 } } });
  });

  // @tg: verifies:: [[openspec:host-bridge#Host persists view state#Viewport restored]] {level: unit}
  it("restores view state from init, else from the webview's own state", () => {
    const withInit = new VsCodeHost({ api: { postMessage() {}, getState: () => ({ view: { a: 1 } }), setState() {} }, fileName: "a.scxml", format: "scxml", text: "", rev: 1, viewState: { b: 2 }, assetBase: "", theme: () => LIGHT_THEME, onThemeChange: () => () => {} });
    expect(withInit.getViewState()).toEqual({ b: 2 });
    const fromState = new VsCodeHost({ api: { postMessage() {}, getState: () => ({ view: { a: 1 } }), setState() {} }, fileName: "a.scxml", format: "scxml", text: "", rev: 1, assetBase: "", theme: () => LIGHT_THEME, onThemeChange: () => () => {} });
    expect(fromState.getViewState()).toEqual({ a: 1 });
  });

  it("publishes diagnostics, reveals spans and exports files through the host", async () => {
    const { host, sent } = setup();
    host.publishDiagnostics([{ message: "m", severity: "error", source: "vertep" }]);
    host.revealText({ start: 3, end: 5 });
    await host.writeFile("order.svg", "<svg/>");
    expect(sent.map((m) => m.type)).toEqual(["diagnostics", "reveal", "writeFile"]);
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: unit}
  it("resolves packaged assets under the extension's own dist folder, with no network", () => {
    expect(setup().host.assetUrl("web/dist/worker.js")).toBe("https://res.test/dist/vertep/web/dist/worker.js");
  });
});

describe("VsCodeHost layout hold after undo", () => {
  // @tg: verifies:: [[openspec:vscode-extension#Native undo and save#Undo through VS Code]] {level: unit}
  it("holds automatic layout after an undo or redo until the next real edit, so undo cannot loop", async () => {
    const { host } = setup("abc", 1);
    expect(host.historyHold).toBe(false);
    host.receive({ type: "textChanged", text: "ab", rev: 2, history: "undo" });
    expect(host.historyHold).toBe(true);
    let ended = false;
    void host.historyHoldEnded().then(() => (ended = true));
    await tick();
    expect(ended).toBe(false);
    host.receive({ type: "textChanged", text: "abx", rev: 3 });
    await tick();
    expect(host.historyHold).toBe(false);
    expect(ended).toBe(true);
  });

  it("ends the hold when the designer applies an edit", () => {
    const { host } = setup("abc", 1);
    host.receive({ type: "textChanged", text: "ab", rev: 2, history: "redo" });
    void host.applyPatches([{ start: 0, end: 0, text: "x" }], "edit");
    expect(host.historyHold).toBe(false);
  });
});
