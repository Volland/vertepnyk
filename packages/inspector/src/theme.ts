import type { ThemeTokens } from "@vertepnyk/host-bridge";

/** Theme tokens as CSS custom properties on the inspector root. */
export function themeVars(t: ThemeTokens): Record<string, string> {
  return {
    "--vi-bg": t.background,
    "--vi-fg": t.foreground,
    "--vi-muted": t.muted,
    "--vi-fill": t.stateFill,
    "--vi-border": t.stateBorder,
    "--vi-accent": t.accent,
    "--vi-error": t.error,
    "--vi-warning": t.warning,
    "--vi-font": t.fontFamily,
    "--vi-font-size": t.fontSize,
    "--vi-mono": t.monoFontFamily,
  };
}
