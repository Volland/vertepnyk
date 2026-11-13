/** Vertepnyk for VS Code: a visual designer and simulator as a custom editor for vertep charts. */
import * as vscode from "vscode";
import { newChart, type Format } from "@vertepnyk/core";
import { DesignerProvider, VIEW_TYPE } from "./provider.js";
import type { DesignerCommand } from "./protocol.js";

const PATTERNS = ["*.scxml", "*.vt.yaml", "*.vt.yml"] as const;
const CHART_FILE = /\.(scxml|vt\.ya?ml)$/i;

/** Makes the designer the default editor for chart files, or hands them back to the text editor. */
// @tg: implements:: [[openspec:vscode-extension#Custom editor for chart files]]
async function syncDefaultEditor(): Promise<void> {
  const want = vscode.workspace.getConfiguration("vertepnyk").get<string>("defaultEditor") === "designer";
  const cfg = vscode.workspace.getConfiguration("workbench");
  const current = { ...(cfg.get<Record<string, string>>("editorAssociations") ?? {}) };
  let changed = false;
  for (const p of PATTERNS) {
    if (want && current[p] !== VIEW_TYPE) {
      current[p] = VIEW_TYPE;
      changed = true;
    } else if (!want && current[p] === VIEW_TYPE) {
      delete current[p];
      changed = true;
    }
  }
  if (changed) await cfg.update("editorAssociations", current, vscode.ConfigurationTarget.Global);
}

let untitledCounter = 0;

// @tg: implements:: [[openspec:vscode-extension#Commands]]
async function newChartCommand(format: Format): Promise<void> {
  const ext = format === "scxml" ? "scxml" : "vt.yaml";
  let uri: vscode.Uri;
  do {
    untitledCounter++;
    uri = vscode.Uri.parse(`untitled:chart-${untitledCounter}.${ext}`);
  } while (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString()));
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 0), newChart(format, "untitled"));
  await vscode.workspace.applyEdit(edit);
  await vscode.commands.executeCommand("vscode.openWith", doc.uri, VIEW_TYPE);
}

function activeUri(arg?: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  return vscode.window.activeTextEditor?.document.uri ?? input?.uri;
}

export function activate(context: vscode.ExtensionContext): { provider: DesignerProvider } {
  const provider = new DesignerProvider(context);
  const retain = vscode.workspace.getConfiguration("vertepnyk").get<boolean>("retainContextWhenHidden") === true;
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: retain } }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("vertepnyk.defaultEditor")) void syncDefaultEditor();
    }),
  );
  void syncDefaultEditor();

  const reg = (id: string, fn: (...args: any[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };
  const forward = (id: string, name: DesignerCommand): void => reg(id, () => provider.target()?.post({ type: "cmd", name }));

  reg("vertepnyk.newScxml", () => newChartCommand("scxml"));
  reg("vertepnyk.newYaml", () => newChartCommand("yaml"));
  // @tg: implements:: [[openspec:vscode-extension#Commands]]
  reg("vertepnyk.openDesigner", async (arg?: unknown) => {
    const uri = activeUri(arg);
    if (!uri || !CHART_FILE.test(uri.path)) {
      void vscode.window.showInformationMessage("Open an .scxml or .vt.yaml file to use the designer.");
      return;
    }
    await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
  });
  // @tg: implements:: [[openspec:vscode-extension#Text and visual toggle]]
  reg("vertepnyk.openTextBeside", async (arg?: unknown) => {
    const doc = provider.target()?.document ?? (activeUri(arg) ? await vscode.workspace.openTextDocument(activeUri(arg)!) : undefined);
    if (doc) await provider.revealText(doc);
  });
  forward("vertepnyk.relayout", "relayout");
  forward("vertepnyk.simStart", "simStart");
  forward("vertepnyk.simReset", "simReset");
  forward("vertepnyk.simStep", "simStep");
  forward("vertepnyk.simBack", "simBack");
  forward("vertepnyk.exportSvg", "exportSvg");

  // not contributed: test hooks
  reg("vertepnyk.debugState", (uri?: string) => provider.debug(uri));
  reg("vertepnyk.debugEdit", (commands: unknown[], uri?: string) => {
    const s = [...provider.sessions].find((x) => uri === undefined || x.document.uri.toString() === uri) ?? provider.target();
    s?.post({ type: "debugEdit", commands });
  });
  forward("vertepnyk.debugFit", "fit");
  reg("vertepnyk.debugUndo", (uri?: string) => {
    const s = [...provider.sessions].find((x) => uri === undefined || x.document.uri.toString() === uri) ?? provider.target();
    s?.post({ type: "debugUndo" });
  });
  return { provider };
}

export function deactivate(): void {}
