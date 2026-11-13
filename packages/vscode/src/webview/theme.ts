/** Theme tokens from VS Code's `--vscode-*` variables, read inside the webview. */
import { tokensFromCss, type ThemeTokens } from "@vertepnyk/host-bridge";

type TokenKey = keyof Omit<ThemeTokens, "kind">;

/** The VS Code variable each token takes, first match wins. */
export const VSCODE_TOKEN_MAP: Partial<Record<TokenKey, readonly string[]>> = {
  background: ["--vscode-editor-background"],
  foreground: ["--vscode-editor-foreground", "--vscode-foreground"],
  muted: ["--vscode-descriptionForeground", "--vscode-disabledForeground"],
  stateFill: ["--vscode-editorWidget-background", "--vscode-sideBar-background", "--vscode-editor-background"],
  stateBorder: ["--vscode-editorWidget-border", "--vscode-panel-border", "--vscode-contrastBorder"],
  accent: ["--vscode-focusBorder", "--vscode-textLink-foreground", "--vscode-button-background"],
  active: ["--vscode-editorWarning-foreground", "--vscode-charts-orange"],
  error: ["--vscode-editorError-foreground", "--vscode-errorForeground"],
  warning: ["--vscode-editorWarning-foreground", "--vscode-charts-yellow"],
  fontFamily: ["--vscode-font-family"],
  fontSize: ["--vscode-font-size"],
  monoFontFamily: ["--vscode-editor-font-family"],
};

/** The theme kind from the classes VS Code puts on the webview body. */
export function kindOf(bodyClasses: Iterable<string>): ThemeTokens["kind"] {
  const set = new Set(bodyClasses);
  if (set.has("vscode-high-contrast-light")) return "high-contrast-light";
  if (set.has("vscode-high-contrast")) return "high-contrast";
  if (set.has("vscode-light")) return "light";
  return "dark";
}

export function readVscodeTheme(style: { getPropertyValue(name: string): string }, bodyClasses: Iterable<string>): ThemeTokens {
  const t = tokensFromCss((n) => style.getPropertyValue(n), VSCODE_TOKEN_MAP, kindOf(bodyClasses));
  // font-size comes without a unit in some builds
  return /^\d+(\.\d+)?$/.test(t.fontSize) ? { ...t, fontSize: `${t.fontSize}px` } : t;
}
