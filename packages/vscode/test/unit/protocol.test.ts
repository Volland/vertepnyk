import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../src/csp.js";
import { isHostMessage, isWebviewMessage } from "../../src/protocol.js";

describe("message protocol", () => {
  it("accepts well-formed webview messages and drops malformed ones", () => {
    expect(isWebviewMessage({ type: "patches", id: 1, rev: 2, label: "edit", patches: [{ start: 0, end: 1, text: "x" }] })).toBe(true);
    expect(isWebviewMessage({ type: "patches", id: 1, rev: 2, label: "edit", patches: [{ start: "0", end: 1, text: "x" }] })).toBe(false);
    expect(isWebviewMessage({ type: "patches", id: 1, label: "edit", patches: [] })).toBe(false);
    expect(isWebviewMessage({ type: "writeFile", suggestedName: "a.svg" })).toBe(false);
    expect(isWebviewMessage({ type: "rm -rf" })).toBe(false);
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage("ready")).toBe(false);
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
  });

  it("recognises host messages by type", () => {
    expect(isHostMessage({ type: "textChanged", text: "", rev: 1 })).toBe(true);
    expect(isHostMessage({ type: "cmd", name: "relayout" })).toBe(true);
    expect(isHostMessage({ type: "ready" })).toBe(false);
  });
});

describe("webview content security policy", () => {
  const csp = contentSecurityPolicy("https://x.vscode-cdn.net", "N0nce");
  const dir = (name: string): string[] => (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

  // @tg: verifies:: [[openspec:vscode-extension#VS Code distribution#Content security policy]] {level: unit}
  it("denies everything by default and allows scripts only by nonce and wasm", () => {
    expect(dir("default-src")).toEqual(["'none'"]);
    expect(dir("script-src")).toEqual(["'nonce-N0nce'", "'wasm-unsafe-eval'"]);
    expect(csp).not.toMatch(/'unsafe-eval'|\*|https?:\/\/(?!x\.vscode-cdn\.net)/);
  });

  // @tg: verifies:: [[openspec:vscode-extension#VS Code distribution#Content security policy]] {level: unit}
  it("keeps 'unsafe-inline' to styles and fetches to the extension's own origin", () => {
    expect(dir("style-src")).toContain("'unsafe-inline'");
    expect(dir("script-src")).not.toContain("'unsafe-inline'");
    expect(dir("connect-src")).toEqual(["https://x.vscode-cdn.net"]);
    expect(dir("worker-src")).toEqual(["https://x.vscode-cdn.net", "blob:"]);
  });
});
