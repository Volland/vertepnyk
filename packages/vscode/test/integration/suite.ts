/**
 * Runs inside VS Code's extension host. A small sequential harness (no mocha): each `it`
 * runs against the one open designer; failures are collected and thrown at the end.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { WebviewStatus } from "../../src/protocol.js";

interface Debug {
  sessions: number;
  webview: WebviewStatus | null;
  diagnostics: { message: string; line: number }[];
  isDirty: boolean | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const debug = async (): Promise<Debug> => vscode.commands.executeCommand<Debug>("vertepnyk.debugState");

async function until<T>(what: string, probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

const results: { name: string; ok: boolean; error?: string }[] = [];
async function it(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    const w = (await debug().catch(() => null))?.webview;
    results.push({ name, ok: false, error: `${(e as Error).message}\n${JSON.stringify({ ...w, text: undefined })}` });
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

/** Tells the runner the designer is on screen and waits (briefly) for it to capture the window. */
async function screenshot(): Promise<void> {
  const dir = process.env.VERTEPNYK_SIGNAL_DIR;
  if (!dir) return;
  for (const c of ["workbench.action.closeAuxiliaryBar", "workbench.action.closeSidebar", "notifications.clearAll"]) await vscode.commands.executeCommand(c);
  await sleep(1000);
  await vscode.commands.executeCommand("vertepnyk.debugFit");
  await sleep(1500);
  const { writeFileSync, existsSync } = await import("node:fs");
  writeFileSync(`${dir}/ready`, "");
  for (let i = 0; i < 60 && !existsSync(`${dir}/shot-done`); i++) await sleep(500);
}

export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0]!.uri;
  const order = vscode.Uri.joinPath(root, "order.scxml");
  const text = (): string => vscode.workspace.textDocuments.find((d) => d.uri.toString() === order.toString())!.getText();
  const doc = (): vscode.TextDocument => vscode.workspace.textDocuments.find((d) => d.uri.toString() === order.toString())!;
  const stateIds = async (): Promise<readonly string[]> => (await debug()).webview?.stateIds ?? [];
  const replaceAll = async (from: string, to: string): Promise<void> => {
    // the designer may be writing a layout at the same moment; VS Code then refuses the edit
    for (let attempt = 0; attempt < 8; attempt++) {
      const d = doc();
      const at = d.getText().indexOf(from);
      assert.ok(at >= 0, `"${from}" in document`);
      const e = new vscode.WorkspaceEdit();
      e.replace(d.uri, new vscode.Range(d.positionAt(at), d.positionAt(at + from.length)), to);
      if (await vscode.workspace.applyEdit(e)) return;
      await sleep(500);
    }
    assert.fail(`could not apply the edit ${from} -> ${to}`);
  };

  const ext = vscode.extensions.getExtension("volland.vertepnyk-vscode");
  assert.ok(ext, "extension is installed from the development path");
  await ext.activate();

  // @tg: verifies:: [[openspec:vscode-extension#Custom editor for chart files#Open a chart visually]] {level: integration}
  await it("opens order.scxml in the visual designer", async () => {
    await vscode.commands.executeCommand("vscode.openWith", order, "vertepnyk.designer");
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === "vertepnyk.designer");
    const d = await until("the designer to show states", async () => {
      const x = await debug();
      return x.webview?.designerMounted && x.webview.stateCount > 0 ? x : undefined;
    });
    assert.ok(["cart", "awaiting_payment", "paid"].every((s) => d.webview!.stateIds.includes(s)), `states: ${d.webview!.stateIds.join(",")}`);
    // let the layout settle, then capture the window when asked
    await sleep(4000);
    if (process.env.VERTEPNYK_SCREENSHOT) await screenshot();
  });

  // @tg: verifies:: [[openspec:vscode-extension#VS Code distribution#Content security policy]] {level: integration}
  await it("loads under the strict CSP with no violations and no webview errors", async () => {
    const d = await debug();
    assert.deepEqual(d.webview!.cspViolations, []);
    assert.deepEqual(d.webview!.errors, []);
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: integration}
  await it("validates and simulates through the WebAssembly worker in the webview", async () => {
    await vscode.commands.executeCommand("vertepnyk.simStart");
    const d = await until("a running simulation", async () => {
      const x = await debug();
      return x.webview?.runConfiguration?.includes("cart") ? x : undefined;
    });
    assert.ok(d.webview!.runConfiguration!.includes("cart"));
    await vscode.commands.executeCommand("vertepnyk.simReset");
    await vscode.commands.executeCommand("vertepnyk.simBack");
  });

  /** Waits until the document stops changing: automatic layout writes its result after an edit. */
  const settled = async (): Promise<void> => {
    let v = doc().version;
    let stable = 0;
    while (stable < 6) {
      await sleep(250);
      if (doc().version === v) stable++;
      else {
        v = doc().version;
        stable = 0;
      }
    }
  };
  /** Presses a VS Code history command until `done` holds (layout writes are undo steps of their own). */
  const press = async (command: "vertepnyk.debugUndo" | "redo" | "undo", done: () => boolean | Promise<boolean>): Promise<number> => {
    for (let n = 1; n <= 4; n++) {
      await vscode.commands.executeCommand(command);
      await sleep(1200);
      console.log(`press ${command} #${n}: version ${doc().version}; ${(text().match(/<state id="refunded"[^>]*>/) ?? ["no refunded state"])[0]}`);
      if (await done()) return n;
    }
    throw new Error(`${command} did not reach the expected text in 4 presses`);
  };

  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: integration}
  await it("a visual edit changes the document text and marks it dirty", async () => {
    await settled();
    await vscode.commands.executeCommand("vertepnyk.debugEdit", [{ type: "addState", parent: null, kind: "state", id: "refunded" }]);
    await until("the new state in the document", () => text().includes('id="refunded"'));
    assert.equal(doc().isDirty, true);
    await settled();
  });

  // @tg: verifies:: [[openspec:vscode-extension#Native undo and save#Undo through VS Code]] {level: integration}
  await it("VS Code's undo removes the visual edit and the designer follows", async () => {
    // the designer's own undo shortcut delegates to VS Code's undo
    const presses = await press("vertepnyk.debugUndo", () => !text().includes('id="refunded"'));
    console.log(`undo took ${presses} press(es)`);
    await until("the designer to drop the state", async () => !(await stateIds()).includes("refunded"));
    await settled();
    await press("redo", () => text().includes('id="refunded"'));
    await until("the designer to show it again", async () => (await stateIds()).includes("refunded"));
    await settled();
    await press("undo", () => !text().includes('id="refunded"'));
    await settled();
  });

  // @tg: verifies:: [[openspec:vscode-extension#Text and visual toggle#Side by side]] {level: integration}
  await it("a state typed in the text editor beside appears in the designer", async () => {
    await vscode.commands.executeCommand("vertepnyk.openTextBeside");
    await until("the text editor beside", () => vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === order.toString()));
    const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === order.toString())!;
    const at = text().indexOf("</scxml>");
    await ed.edit((b) => b.insert(doc().positionAt(at), '  <state id="typed"/>\n'));
    await until("the designer to show the typed state", async () => (await stateIds()).includes("typed"));
  });

  // @tg: verifies:: [[openspec:vscode-extension#Problems panel#Violation in Problems]] {level: integration}
  await it("an unknown transition target is listed in the Problems collection", async () => {
    await replaceAll('target="paid"', 'target="nowhere"');
    const diags = await until("a diagnostic for the file", () => {
      const d = vscode.languages.getDiagnostics(order).filter((x) => /nowhere/.test(x.message) || x.source === "vertep");
      return d.length > 0 ? d : undefined;
    });
    assert.ok(diags[0]!.range.start.line >= 0);
    await replaceAll('target="nowhere"', 'target="paid"');
    await until("the diagnostic to clear", () => vscode.languages.getDiagnostics(order).length === 0);
  });

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: integration}
  await it("switching to a light theme reaches the designer without reopening", async () => {
    const cfg = vscode.workspace.getConfiguration("workbench");
    const dark = (await debug()).webview!.theme;
    const target = dark === "light" ? "Default Dark Modern" : "Default Light Modern";
    await cfg.update("colorTheme", target, vscode.ConfigurationTarget.Global);
    await until("the webview theme to change", async () => (await debug()).webview?.theme !== dark);
  });

  // @tg: verifies:: [[openspec:vscode-extension#Commands#New chart command]] {level: integration}
  await it("the new YAML chart command opens an untitled .vt.yaml in the designer", async () => {
    await vscode.commands.executeCommand("vertepnyk.newYaml");
    const tab = await until("a designer tab", () => {
      const t = vscode.window.tabGroups.activeTabGroup.activeTab;
      return t?.input instanceof vscode.TabInputCustom && t.input.viewType === "vertepnyk.designer" && t.input.uri.path.endsWith(".vt.yaml") ? t : undefined;
    });
    assert.equal((tab.input as vscode.TabInputCustom).uri.scheme, "untitled");
    await until("the new chart to render", async () => {
      const x = await debug();
      return x.webview?.designerMounted && x.webview.stateCount > 0;
    });
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} integration tests passed`);
  if (failed.length > 0) throw new Error(failed.map((f) => `${f.name}: ${f.error}`).join("\n\n"));
}
