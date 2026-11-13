import { afterEach, describe, expect, it } from "vitest";
import { DARK_THEME, LIGHT_THEME } from "@vertepnyk/host-bridge";
import { ThemeSource, obsidianTokens } from "../src/theme.js";
import { loadPlugin } from "./helpers.js";

const VARS: Record<string, string> = {
  "--background-primary": "#202020",
  "--text-normal": "#dadada",
  "--text-muted": "#a0a0a0",
  "--background-secondary": "#262626",
  "--background-modifier-border": "#363636",
  "--interactive-accent": "#7b6cd9",
  "--color-orange": "#e0752d",
  "--text-error": "#fb464c",
  "--font-interface": "Inter, sans-serif",
  "--font-monospace": "Fira Code, monospace",
};

function dress(dark: boolean, vars = VARS): void {
  document.body.className = dark ? "theme-dark" : "theme-light";
  for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
}
afterEach(() => {
  document.body.className = "";
  document.body.removeAttribute("style");
});

describe("theme", () => {
  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: unit}
  it("builds tokens from Obsidian's CSS variables", () => {
    dress(true);
    const t = obsidianTokens();
    expect(t.kind).toBe("dark");
    expect(t.background).toBe("#202020");
    expect(t.foreground).toBe("#dadada");
    expect(t.muted).toBe("#a0a0a0");
    expect(t.stateFill).toBe("#262626");
    expect(t.stateBorder).toBe("#363636");
    expect(t.accent).toBe("#7b6cd9");
    expect(t.active).toBe("#e0752d");
    expect(t.error).toBe("#fb464c");
    expect(t.fontFamily).toBe("Inter, sans-serif");
    expect(t.monoFontFamily).toBe("Fira Code, monospace");
    // what the app does not define falls back to the host-bridge defaults
    expect(t.warning).toBe(DARK_THEME.warning);
  });

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: unit}
  it("takes the kind from the body class and defaults when no variables exist", () => {
    dress(false, {});
    expect(obsidianTokens()).toEqual(LIGHT_THEME);
    document.body.className = "theme-dark";
    expect(obsidianTokens().kind).toBe("dark");
  });

  // @tg: verifies:: [[openspec:host-bridge#Host theme is applied#VS Code theme change]] {level: integration}
  it("follows css-change without reopening", async () => {
    dress(false);
    const { app, plugin } = await loadPlugin();
    const seen: string[] = [];
    plugin.theme.subscribe((t) => seen.push(`${t.kind}:${t.background}`));
    expect(plugin.theme.tokens().kind).toBe("light");
    dress(true);
    app.workspace.trigger("css-change");
    expect(seen).toEqual(["dark:#202020"]);
    // no change, no notification
    app.workspace.trigger("css-change");
    expect(seen).toHaveLength(1);
    expect(new ThemeSource().tokens().kind).toBe("dark");
  });
});
