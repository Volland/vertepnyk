import type { DesignerHandle } from "@vertepnyk/designer";

declare global {
  interface Window {
    __vertepnyk?: { host: { getText(): string; dirty: boolean; fileName: string }; handle: DesignerHandle | undefined; path: string | null };
    vertepnykFiles?: Record<string, unknown>;
  }
}
