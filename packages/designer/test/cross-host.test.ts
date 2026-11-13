// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHost, DARK_THEME, LIGHT_THEME, type HostBridge } from "@vertepnyk/host-bridge";
import { DesignerController } from "../src/controller.js";
// The three real host adapters, instantiated without their editors: the session below reads
// the buffer, the theme and the document only.
import { BufferHost } from "../../obsidian/src/host.js";
import { VsCodeHost } from "../../vscode/src/webview/host.js";
import { WebHost } from "../../web-shell/src/WebHost.js";

const text = readFileSync(new URL("../../../fixtures/order.scxml", import.meta.url), "utf8");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const controllers: DesignerController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

const themeSource = { tokens: () => LIGHT_THEME, subscribe: () => () => undefined };

const hosts: Record<string, () => HostBridge> = {
  // the web shell and the Electron renderer both use WebHost
  "web / Electron": () =>
    new WebHost({ fileName: "order.scxml", format: "scxml", text, theme: themeSource as never }),
  memory: () => createMemoryHost({ fileName: "order.scxml", format: "scxml", text }),
  Obsidian: () =>
    new BufferHost({ fileName: "order.scxml", format: "scxml", text, theme: themeSource as never }),
  "VS Code": () =>
    new VsCodeHost({
      api: { postMessage: () => undefined, getState: () => undefined, setState: () => undefined },
      fileName: "order.scxml",
      format: "scxml",
      text,
      rev: 1,
      assetBase: "vscode-resource://x/",
      theme: () => DARK_THEME,
      onThemeChange: () => () => undefined,
    }),
};

/** The same scripted session on one host: start, add, add, checkout. */
async function session(host: HostBridge) {
  const ctl = new DesignerController(host, { validationDelayMs: 10 });
  controllers.push(ctl);
  const started = await ctl.startSimulation();
  expect(started.ok).toBe(true);
  await ctl.send("add");
  await ctl.send("add");
  const run = await ctl.send("checkout");
  await wait(20);
  return { configuration: [...run.configuration], context: run.context, version: run.version };
}

describe("every host runs the same chart the same way", () => {
  // @tg: verifies:: [[openspec:host-bridge#Same behaviour in every host#Cross-host simulation]] {level: integration}
  it("ends the same three events in the same configuration with the same context on web/Electron, Obsidian, VS Code and the memory host", async () => {
    const results: Record<string, Awaited<ReturnType<typeof session>>> = {};
    for (const [name, make] of Object.entries(hosts)) results[name] = await session(make());
    const [first, ...rest] = Object.values(results);
    expect(first?.configuration).toEqual(["awaiting_payment"]);
    expect(first?.context).toMatchObject({ items: 2 });
    for (const r of rest) expect(r).toEqual(first);
  });
});
