import type { ShellGlobals } from "../src/App.js";

declare global {
  interface Window {
    __vertepnyk?: ShellGlobals;
  }
}
