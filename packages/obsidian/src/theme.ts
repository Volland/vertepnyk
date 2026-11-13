/** Theme tokens from Obsidian's CSS variables, refreshed when the app's CSS changes. */
import { tokensFromCss, type ThemeTokens, type Unsubscribe } from "@vertepnyk/host-bridge";

/** Obsidian CSS variables per token, first non-empty wins. */
export const OBSIDIAN_VARS = {
  background: ["--background-primary"],
  foreground: ["--text-normal"],
  muted: ["--text-muted"],
  stateFill: ["--background-secondary", "--background-primary-alt"],
  stateBorder: ["--background-modifier-border-hover", "--background-modifier-border", "--text-faint"],
  accent: ["--interactive-accent"],
  active: ["--color-orange", "--text-accent"],
  error: ["--text-error", "--color-red"],
  warning: ["--color-yellow"],
  fontFamily: ["--font-interface", "--font-text"],
  fontSize: ["--font-ui-small"],
  monoFontFamily: ["--font-monospace"],
} as const;

/** Tokens for the current theme of `body` (Obsidian puts `theme-dark` / `theme-light` on it). */
export function obsidianTokens(body: HTMLElement = document.body): ThemeTokens {
  const style = getComputedStyle(body);
  const kind = body.classList.contains("theme-dark") ? "dark" : "light";
  return tokensFromCss((name) => style.getPropertyValue(name), OBSIDIAN_VARS, kind);
}

/** The current tokens and their listeners; one per plugin, `refresh` is called on `css-change`. */
// @tg: implements:: [[openspec:host-bridge#Host theme is applied]]
export class ThemeSource {
  #tokens: ThemeTokens;
  readonly #listeners = new Set<(t: ThemeTokens) => void>();
  readonly #body: HTMLElement;

  constructor(body: HTMLElement = document.body) {
    this.#body = body;
    this.#tokens = obsidianTokens(body);
  }

  tokens(): ThemeTokens {
    return this.#tokens;
  }

  subscribe(listener: (t: ThemeTokens) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Re-reads the variables; notifies listeners when a token changed. */
  refresh(): void {
    const next = obsidianTokens(this.#body);
    if (JSON.stringify(next) === JSON.stringify(this.#tokens)) return;
    this.#tokens = next;
    for (const l of this.#listeners) l(next);
  }
}
