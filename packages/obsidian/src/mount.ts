/** Mounting the full designer on a host, with the plugin's engine assets and settings. */
import { mountDesigner, type DesignerHandle } from "@vertepnyk/designer";
import type { HostBridge } from "@vertepnyk/host-bridge";
import type VertepnykPlugin from "./main.js";

/**
 * Mounts `<Designer>` in `el` on `host`. Resolves to a disposer once the engine assets and the
 * layout worker are ready; `onReady` gets the designer's handle.
 */
export async function mountDesignerIn(
  plugin: VertepnykPlugin,
  el: HTMLElement,
  host: HostBridge,
  onReady?: (h: DesignerHandle) => void,
): Promise<() => void> {
  const layoutClient = await plugin.assets.layoutClient();
  let engine: Awaited<ReturnType<typeof plugin.assets.engine>> | undefined;
  try {
    engine = await plugin.assets.engine();
  } catch (e) {
    // validation and simulation are unavailable without the engine; editing still works
    console.warn("vertepnyk: the vertep engine could not be loaded", e);
    host.notify?.("The vertep engine could not be loaded; validation and simulation are unavailable.", "warning");
  }
  return mountDesigner(
    el,
    host,
    { layoutClient, validationDelayMs: plugin.settings.validationDelayMs, ...(engine ? { engine } : {}) },
    onReady,
  );
}
