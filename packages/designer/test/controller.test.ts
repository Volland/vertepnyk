// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHost, type MemoryHost } from "@vertepnyk/host-bridge";
import { DesignerController } from "../src/controller.js";

const fixture = (n: string) => readFileSync(new URL(`../../../fixtures/${n}`, import.meta.url), "utf8");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await wait(20);
  }
}

let ctl: DesignerController | undefined;
afterEach(() => {
  ctl?.dispose();
  ctl = undefined;
});

function open(name = "order.scxml"): { host: MemoryHost; ctl: DesignerController } {
  const host = createMemoryHost({
    fileName: name,
    format: name.endsWith(".scxml") ? "scxml" : "yaml",
    text: fixture(name),
  });
  ctl = new DesignerController(host, { validationDelayMs: 20 });
  return { host, ctl };
}

describe("designer controller on a host", () => {
  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: integration}
  it("sends a visual edit to the host buffer, which is then modified", async () => {
    const { host, ctl } = open();
    expect(host.saved).toBe(true);
    ctl.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "refunded" });
    await until(() => host.getText().includes("refunded"));
    expect(host.saved).toBe(false);
  });

  // @tg: verifies:: [[openspec:chart-document#Text is the source of truth#External text change appears on the canvas]] {level: integration}
  it("reflects an external text change in the model", () => {
    const { host, ctl } = open();
    host.setExternalText(host.getText().replace('<state id="paid"/>', '<state id="paid"/><state id="refunded"/>'));
    expect(ctl.doc.model?.states.has("refunded")).toBe(true);
  });

  it("trusts the host's text when the host refuses a patch", async () => {
    const { host, ctl } = open();
    host.refuseNextPatch();
    const external = host.getText().replace('<state id="paid"/>', '<state id="paid"/><final id="x"/>');
    ctl.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "refunded" });
    host.setExternalText(external); // the buffer changed meanwhile
    await wait(30);
    expect(ctl.doc.text).toBe(host.getText());
  });

  // @tg: verifies:: [[openspec:chart-validation#Continuous validation#Results follow the latest text]] {level: integration}
  it("validates after edits and publishes only the latest text's diagnostics", async () => {
    const { host, ctl } = open();
    await until(() => ctl.state.validation.status === "valid");
    host.setExternalText(host.getText().replace('target="paid"', 'target="nowhere"'));
    ctl.doc.apply({ type: "addTransition", source: "cart", targets: ["paid"], events: ["y"] }); // within the debounce
    await until(() => ctl.state.validation.status === "invalid");
    expect(ctl.state.diagnostics.length).toBeGreaterThan(0);
    expect(host.diagnostics.length).toBeGreaterThan(0);
    expect(host.diagnostics[0]?.source).toBe("vertep");
  });

  it("reports an unparseable text and recovers when it parses again", async () => {
    const { host, ctl } = open();
    host.setExternalText("<scxml");
    expect(ctl.state.validation.status).toBe("unparseable");
    expect(ctl.state.parseError).not.toBeNull();
    host.setExternalText(fixture("order.scxml"));
    await until(() => ctl.state.validation.status === "valid");
    expect(ctl.state.parseError).toBeNull();
  });

  // @tg: verifies:: [[openspec:chart-simulation#Live edits during simulation#Replay on edit]] {level: integration}
  it("marks a run stale after an edit and replays its events on the edited chart", async () => {
    const { ctl } = open();
    await until(() => ctl.state.validation.status === "valid");
    const started = await ctl.startSimulation();
    expect(started.ok).toBe(true);
    await ctl.send("add");
    ctl.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "extra" });
    expect(ctl.state.runStale).toBe(true);
    const r = await ctl.replaySimulation();
    expect(r.ok).toBe(true);
    expect(ctl.state.runStale).toBe(false);
    expect(ctl.state.run?.configuration.length).toBeGreaterThan(0);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Start and reset#Invalid chart does not start]] {level: integration}
  it("does not start a run of an invalid chart and shows the violation", async () => {
    const { host, ctl } = open();
    host.setExternalText(host.getText().replace('target="paid"', 'target="nowhere"'));
    const r = await ctl.startSimulation();
    expect(r.ok).toBe(false);
    expect(ctl.state.validation.status).toBe("invalid");
  });
});
