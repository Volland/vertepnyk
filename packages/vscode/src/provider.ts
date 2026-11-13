/**
 * The custom text editor: one `Session` per open designer webview, all on VS Code's own
 * `TextDocument`. Visual edits arrive as patches and become one `WorkspaceEdit`; text edits
 * (typing in the text editor beside, undo, git operations) flow back as `textChanged`.
 */
import * as vscode from "vscode";
import { detectFormat, type Format } from "@vertepnyk/core";
import { contentSecurityPolicy } from "./csp.js";
import { checkRev, patchesToEdits, revealRange, toDiagnostics, type DocLike } from "./convert.js";
import { isWebviewMessage, type DesignerCommand, type HostMessage, type RevealTarget, type WebviewMessage, type WebviewStatus } from "./protocol.js";

export const VIEW_TYPE = "vertepnyk.designer";

const SEVERITY = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information } as const;

export function docLike(d: vscode.TextDocument): DocLike {
  return {
    get version() {
      return d.version;
    },
    get lineCount() {
      return d.lineCount;
    },
    positionAt: (o) => d.positionAt(o),
    lineLength: (l) => d.lineAt(l).text.length,
    textLength: () => d.getText().length,
  };
}

export const formatOfFile = (name: string): Format => detectFormat(name) ?? (/\.ya?ml$/i.test(name) ? "yaml" : "scxml");

export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const dist = vscode.Uri.joinPath(extensionUri, "dist");
  const asset = (name: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(dist, name));
  const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  const base = `${webview.asWebviewUri(dist).toString()}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(webview.cspSource, nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground)}</style>
<title>Vertepnyk</title>
</head>
<body>
<div id="root" data-base="${base}"></div>
<script type="module" nonce="${nonce}" src="${asset("webview.js")}"></script>
</body>
</html>`;
}

export class Session {
  /** True while this session's own patches are being applied, so their change event is not echoed. */
  applying = false;
  simRunning = false;
  readonly pending = new Map<number, (s: WebviewStatus) => void>();
  ready = false;
  viewStateTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    readonly document: vscode.TextDocument,
    readonly panel: vscode.WebviewPanel,
  ) {}
  post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }
}

export class DesignerProvider implements vscode.CustomTextEditorProvider {
  readonly sessions = new Set<Session>();
  active: Session | undefined;
  readonly diagnostics = vscode.languages.createDiagnosticCollection("vertepnyk");
  #nextDebug = 1;
  readonly #output = vscode.window.createOutputChannel("Vertepnyk");

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this.diagnostics,
      this.#output,
      vscode.workspace.onDidChangeTextDocument((e) => this.#onTextChanged(e)),
      vscode.workspace.onDidCloseTextDocument((d) => this.diagnostics.delete(d.uri)),
    );
  }

  // @tg: implements:: [[openspec:vscode-extension#Custom editor for chart files]]
  // @tg: implements:: [[openspec:vscode-extension#VS Code distribution]]
  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const root = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    panel.webview.options = { enableScripts: true, localResourceRoots: [root] };
    panel.webview.html = renderHtml(panel.webview, this.context.extensionUri);
    const session = new Session(document, panel);
    this.sessions.add(session);
    if (panel.active) this.active = session;

    panel.onDidChangeViewState(() => {
      if (panel.active) this.active = session;
      void vscode.commands.executeCommand("setContext", "vertepnyk.designerActive", this.active?.panel.active === true);
    });
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      if (this.active === session) this.active = undefined;
      if (![...this.sessions].some((s) => s.document === document)) this.diagnostics.delete(document.uri);
    });
    panel.webview.onDidReceiveMessage((m: unknown) => {
      if (isWebviewMessage(m)) void this.#onMessage(session, m).catch((e: unknown) => this.#output.appendLine(`error: ${String((e as Error).message ?? e)}`));
    });
  }

  #viewKey(d: vscode.TextDocument): string {
    return `view:${d.uri.toString()}`;
  }

  // @tg: implements:: [[openspec:vscode-extension#Native undo and save]]
  // @tg: implements:: [[openspec:vscode-extension#Problems panel]]
  // @tg: implements:: [[openspec:vscode-extension#Text and visual toggle]]
  async #onMessage(s: Session, m: WebviewMessage): Promise<void> {
    const doc = s.document;
    switch (m.type) {
      case "ready": {
        s.ready = true;
        const viewState = this.context.workspaceState.get<Record<string, unknown>>(this.#viewKey(doc));
        s.post({
          type: "init",
          text: doc.getText(),
          format: formatOfFile(doc.fileName),
          fileName: doc.uri.path.split("/").pop() ?? doc.fileName,
          rev: doc.version,
          ...(viewState ? { viewState } : {}),
        });
        break;
      }
      case "patches": {
        const check = checkRev(m.rev, doc.version);
        if (!check.ok) {
          s.post({ type: "ack", id: m.id, ok: false, rev: doc.version, text: doc.getText() });
          break;
        }
        let ok = false;
        try {
          const edit = new vscode.WorkspaceEdit();
          for (const e of patchesToEdits(docLike(doc), m.patches)) {
            edit.replace(doc.uri, new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText, { label: m.label, needsConfirmation: false });
          }
          s.applying = true;
          ok = await vscode.workspace.applyEdit(edit);
        } catch (e) {
          this.#output.appendLine(`patch refused: ${String((e as Error).message ?? e)}`);
        } finally {
          s.applying = false;
        }
        s.post(ok ? { type: "ack", id: m.id, ok: true, rev: doc.version } : { type: "ack", id: m.id, ok: false, rev: doc.version, text: doc.getText() });
        break;
      }
      case "diagnostics": {
        const list = toDiagnostics(docLike(doc), m.list).map((d) => {
          const diag = new vscode.Diagnostic(new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.message, SEVERITY[d.severity]);
          diag.source = d.source;
          if (d.code !== undefined) diag.code = d.code;
          return diag;
        });
        this.diagnostics.set(doc.uri, list);
        break;
      }
      case "reveal":
        await this.revealText(doc, m.target);
        break;
      case "viewState":
        clearTimeout(s.viewStateTimer);
        s.viewStateTimer = setTimeout(() => void this.context.workspaceState.update(this.#viewKey(doc), m.state), 300);
        break;
      case "simRunning":
        s.simRunning = m.running;
        break;
      case "undo":
      case "redo":
        // VS Code's undo acts on the active editor, which must be this designer
        if (!s.panel.active) s.panel.reveal(s.panel.viewColumn, false);
        await vscode.commands.executeCommand(m.type);
        break;
      case "save":
        await doc.save();
        break;
      case "writeFile":
        await this.#writeFile(doc, m.suggestedName, m.contents);
        break;
      case "notify": {
        const show = m.severity === "error" ? vscode.window.showErrorMessage : m.severity === "warning" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
        void show(m.message);
        break;
      }
      case "log":
        this.#output.appendLine(`[webview ${m.level}] ${m.message}`);
        break;
      case "debugState":
        s.pending.get(m.id)?.(m.state);
        s.pending.delete(m.id);
        break;
    }
  }

  /** Shows the text editor beside the designer, selecting `target` when given. */
  async revealText(doc: vscode.TextDocument, target?: RevealTarget): Promise<void> {
    const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false };
    if (target) {
      const r = revealRange(docLike(doc), target);
      options.selection = new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
    }
    await vscode.commands.executeCommand("vscode.openWith", doc.uri, "default", options);
  }

  async #writeFile(doc: vscode.TextDocument, name: string, contents: string): Promise<void> {
    const dir = doc.uri.scheme === "file" ? vscode.Uri.joinPath(doc.uri, "..") : vscode.workspace.workspaceFolders?.[0]?.uri;
    const target = await vscode.window.showSaveDialog({ ...(dir ? { defaultUri: vscode.Uri.joinPath(dir, name) } : {}), filters: { SVG: ["svg"], "All files": ["*"] } });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(contents));
  }

  // @tg: implements:: [[openspec:vscode-extension#Text and visual toggle]]
  #onTextChanged(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) return;
    for (const s of this.sessions) {
      if (s.document !== e.document || s.applying || !s.ready) continue;
      const history = e.reason === vscode.TextDocumentChangeReason.Undo ? "undo" : e.reason === vscode.TextDocumentChangeReason.Redo ? "redo" : undefined;
      s.post({ type: "textChanged", text: e.document.getText(), rev: e.document.version, ...(history ? { history } : {}) });
    }
  }

  forward(name: DesignerCommand): void {
    this.active?.post({ type: "cmd", name });
  }

  /** The session a command acts on: the active designer, else the only one open. */
  target(): Session | undefined {
    return this.active ?? (this.sessions.size === 1 ? [...this.sessions][0] : undefined);
  }

  /** For the integration test: what the webview reports. */
  async debug(uri?: string, timeoutMs = 15_000): Promise<{ sessions: number; webview: WebviewStatus | null; diagnostics: { message: string; line: number }[]; isDirty: boolean | null }> {
    const s = [...this.sessions].find((x) => uri === undefined || x.document.uri.toString() === uri) ?? this.target();
    if (!s) return { sessions: this.sessions.size, webview: null, diagnostics: [], isDirty: null };
    const id = this.#nextDebug++;
    const webview = await new Promise<WebviewStatus | null>((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      s.pending.set(id, (st) => {
        clearTimeout(t);
        resolve(st);
      });
      s.post({ type: "debug", id });
    });
    return {
      sessions: this.sessions.size,
      webview,
      diagnostics: (this.diagnostics.get(s.document.uri) ?? []).map((d) => ({ message: d.message, line: d.range.start.line + 1 })),
      isDirty: s.document.isDirty,
    };
  }
}
