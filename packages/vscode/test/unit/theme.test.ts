import { describe, expect, it } from "vitest";
import { DARK_THEME, LIGHT_THEME } from "@vertepnyk/host-bridge";
import { kindOf, readVscodeTheme } from "../../src/webview/theme.js";

/** A stand-in for `getComputedStyle(document.documentElement)`. */
const style = (vars: Record<string, string>) => ({ getPropertyValue: (n: string) => vars[n] ?? "" });

describe("theme tokens from --vscode-* variables", () => {
  const vars = {
    "--vscode-editor-background": "#1e1e1e",
    "--vscode-editor-foreground": " #d4d4d4 ",
    "--vscode-editorWidget-background": "#252526",
    "--vscode-focusBorder": "#007fd4",
    "--vscode-editorError-foreground": "#f14c4c",
    "--vscode-font-family": "Segoe UI",
    "--vscode-font-size": "13",
    "--vscode-editor-font-family": "Consolas",
  };

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: unit}
  it("maps variables to tokens, trimming and falling back to the first available name", () => {
    const t = readVscodeTheme(style(vars), ["vscode-dark"]);
    expect(t).toMatchObject({ kind: "dark", background: "#1e1e1e", foreground: "#d4d4d4", stateFill: "#252526", accent: "#007fd4", error: "#f14c4c", fontFamily: "Segoe UI", fontSize: "13px", monoFontFamily: "Consolas" });
  });

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: unit}
  it("takes defaults of the right kind for variables VS Code does not set", () => {
    expect(readVscodeTheme(style({}), ["vscode-light"]).background).toBe(LIGHT_THEME.background);
    expect(readVscodeTheme(style({}), ["vscode-dark"]).background).toBe(DARK_THEME.background);
  });

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: unit}
  it("reads the kind from the body class, high contrast first", () => {
    expect(kindOf(["vscode-light"])).toBe("light");
    expect(kindOf(["vscode-dark"])).toBe("dark");
    expect(kindOf(["vscode-high-contrast"])).toBe("high-contrast");
    expect(kindOf(["vscode-high-contrast", "vscode-high-contrast-light"])).toBe("high-contrast-light");
    expect(kindOf([])).toBe("dark");
  });
});
