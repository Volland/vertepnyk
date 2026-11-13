/**
 * Themes for the page: vertep's folk-woodcut palette (ink, cream, orange), a manual toggle
 * and `prefers-color-scheme`. Everything else in the page is drawn from these tokens.
 */
import type { ThemeTokens } from "@vertepnyk/host-bridge";

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const WOODCUT_LIGHT: ThemeTokens = {
  kind: "light",
  background: "#fbf6ec",
  foreground: "#17120f",
  muted: "#74685b",
  stateFill: "#fffdf8",
  stateBorder: "#8c7d6b",
  accent: "#1f6b6b",
  active: "#e8641c",
  error: "#b42318",
  warning: "#a15c07",
  fontFamily: FONT,
  fontSize: "13px",
  monoFontFamily: MONO,
};

export const WOODCUT_DARK: ThemeTokens = {
  kind: "dark",
  background: "#17120f",
  foreground: "#f3ead8",
  muted: "#a2937f",
  stateFill: "#231c17",
  stateBorder: "#6f6150",
  accent: "#63b8b0",
  active: "#f0873a",
  error: "#f47a6e",
  warning: "#e0a84a",
  fontFamily: FONT,
  fontSize: "13px",
  monoFontFamily: MONO,
};

export type ThemeMode = "auto" | "light" | "dark";
const KEY = "vertepnyk:theme";

export interface ThemeStore {
  mode(): ThemeMode;
  setMode(mode: ThemeMode): void;
  tokens(): ThemeTokens;
  subscribe(listener: (t: ThemeTokens) => void): () => void;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // storage may be blocked
  }
  return "auto";
}

export function createThemeStore(): ThemeStore {
  let mode = readMode();
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  const listeners = new Set<(t: ThemeTokens) => void>();
  const compute = (): ThemeTokens => (mode === "auto" ? (media?.matches ? WOODCUT_DARK : WOODCUT_LIGHT) : mode === "dark" ? WOODCUT_DARK : WOODCUT_LIGHT);
  let current = compute();
  const update = (): void => {
    current = compute();
    for (const l of listeners) l(current);
  };
  media?.addEventListener("change", () => mode === "auto" && update());
  return {
    mode: () => mode,
    setMode(m) {
      mode = m;
      try {
        localStorage.setItem(KEY, m);
      } catch {
        // ignore
      }
      update();
    },
    tokens: () => current,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
