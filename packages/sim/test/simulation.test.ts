import { afterEach, describe, expect, it } from "vitest";
import { PayloadTypeError, SimulationError, Simulator } from "../src/index.js";
import { CONFLICT, ECMA, ORDER, UNKNOWN_TARGET, fixture, orderChart } from "./charts.js";

let sim: Simulator;
const open = () => {
  sim = new Simulator();
  return sim;
};
afterEach(async () => {
  await sim?.dispose();
});

async function started(text = ORDER) {
  const s = open();
  const r = await s.start(text, "scxml");
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return s;
}

describe("chart simulation on vertep", () => {
  // @tg: verifies:: [[openspec:chart-simulation#Start and reset#Start shows the initial configuration]] {level: integration}
  it("start shows the initial configuration", async () => {
    const s = await started();
    expect(s.state?.step).toBe(0);
    expect(s.state?.configuration).toEqual(["idle"]);
    expect(s.state?.context).toEqual({ total: 0, declined: 0, checks: 0 });
    expect(s.state?.version).toMatch(/^urn:vertep:chart:sha256:/);
    await s.send("start");
    const reset = await s.reset();
    expect(reset.configuration).toEqual(["idle"]);
    expect(reset.head).toBe(0);
    expect(s.log).toEqual([]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Start and reset#Invalid chart does not start]] {level: integration}
  it("invalid chart does not start and returns the violation", async () => {
    const s = open();
    const r = await s.start(UNKNOWN_TARGET, "scxml");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.message).toBe("transition target names unknown state `missing`");
    expect(r.violations[0]?.line).toBe(2);
    expect(s.state).toBeNull();
    await expect(s.send("x")).rejects.toMatchObject({ code: "NotStarted" });
  });

  // @tg: verifies:: [[openspec:chart-simulation#Active configuration is highlighted#Highlight after an event]] {level: integration}
  it("an event changes the configuration and marks the transition taken", async () => {
    const s = await started();
    const st = await s.send("start");
    expect(st.configuration).toEqual(["checkout", "cart"]);
    expect(st.configuration).not.toContain("idle");
    expect(st.transitions).toEqual([
      expect.objectContaining({ id: "idle#0", source: "idle", index: 0, targets: ["checkout"], events: ["start"] }),
    ]);
    expect(st.step).toBe(1);
    expect(st.live).toBe(true);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Send events with payload#Guard uses the payload]] {level: integration}
  it("a false guard on the payload keeps the configuration", async () => {
    const s = await started();
    await s.send("start");
    const st = await s.send("pay", { amount: 0 });
    expect(st.configuration).toEqual(["checkout", "cart"]);
    expect(st.context.total).toBe(0);
    expect(st.transitions.map((t) => t.id)).toEqual(["cart#1"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Context is shown#Assign shows in context]] {level: integration}
  it("an assignment shows in the context, marked as changed", async () => {
    const s = await started();
    await s.send("start");
    const st = await s.send("pay", { amount: 150 });
    expect(st.context.total).toBe(150);
    expect(st.changed).toEqual(["total"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Enabled events are offered#Enabled events in cart]] {level: integration}
  it("offers the enabled events in cart", async () => {
    const s = await started();
    // step 0: vertep answers `can` only after a journal entry, so a probe actor answers
    expect(await s.enabledEvents(["start", "pay", "cancel"])).toEqual(["start"]);
    await s.send("start");
    const enabled = await s.enabledEvents(["start", "pay", "cancel", "nope"]);
    expect(enabled).toContain("pay");
    expect(enabled).toContain("cancel");
    expect(enabled).not.toContain("start");
    expect(enabled).not.toContain("nope");
    // nothing was sent to the run
    expect(s.state?.head).toBe(1);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Simulation runs on the vertep interpreter#Conflict resolution matches vertep]] {level: integration}
  it("takes the child's transition over its ancestor's", async () => {
    const s = await started(CONFLICT);
    expect(s.state?.configuration).toEqual(["outer", "inner"]);
    const st = await s.send("e");
    expect(st.configuration).toEqual(["fromChild"]);
    expect(st.transitions.map((t) => t.source)).toEqual(["inner"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Event log#Raised event appears in the log]] {level: integration}
  it("logs a raised event as internal in the same macrostep", async () => {
    const s = await started();
    await s.send("start");
    await s.send("check");
    const entry = s.log[1];
    expect(entry?.event).toEqual({ name: "check", data: null, origin: "external" });
    expect(entry?.transitions.map((t) => t.id)).toEqual(["cart#2", "cart#3"]);
    expect(entry?.internal).toEqual([
      { name: "checked", descriptors: ["checked"], transitions: ["cart#3"], inferred: true },
    ]);
    expect(entry?.configuration).toEqual(["checkout", "cart"]);
    expect(entry?.context.checks).toBe(1);
    expect(s.log.map((e) => e.step)).toEqual([1, 2]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Time travel#Step back]] {level: integration}
  it("steps back to the state after the second macrostep", async () => {
    const s = await started();
    await s.send("start");
    await s.send("check");
    await s.send("pay", { amount: 0 });
    expect(s.state?.context).toMatchObject({ checks: 1, declined: 1 });
    const back = await s.back();
    expect(back.step).toBe(2);
    expect(back.live).toBe(false);
    expect(back.configuration).toEqual(["checkout", "cart"]);
    expect(back.context).toMatchObject({ checks: 1, declined: 0 });
    const fwd = await s.forward();
    expect(fwd.step).toBe(3);
    expect(fwd.context).toMatchObject({ declined: 1 });
    expect((await s.goto(0)).configuration).toEqual(["idle"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Time travel#Fork from the past]] {level: integration}
  it("forks a new run from an earlier step and keeps the original", async () => {
    const s = await started();
    await s.send("start");
    await s.send("check");
    await s.send("pay", { amount: 0 });
    const original = s.activeRun!;
    await s.goto(1);
    const st = await s.send("cancel");
    expect(st.done).toBe(true);
    expect(st.finalStates).toEqual(["cancelled"]);
    expect(s.runs).toHaveLength(2);
    const fork = s.activeRun!;
    expect(fork.id).not.toBe(original.id);
    expect(fork.parent).toEqual({ runId: original.id, step: 1 });
    expect(s.log.map((e) => [e.event.name, e.replayed])).toEqual([
      ["start", true],
      ["cancel", false],
    ]);
    const back = await s.selectRun(original.id);
    expect(back.head).toBe(3);
    expect(s.log.map((e) => e.event.name)).toEqual(["start", "check", "pay"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Live edits during simulation#Replay on edit]] {level: integration}
  it("replays the run's events on the edited chart", async () => {
    const s = await started();
    await s.send("start");
    await s.send("check");
    await s.send("pay", { amount: 50 });
    expect(s.state?.done).toBe(true);
    s.markStale();
    expect(s.state?.stale).toBe(true);
    const r = await s.replay(orderChart("ev.data.amount > 100"), "scxml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(3);
    expect(r.state.stale).toBe(false);
    expect(s.log.map((e) => [e.event.name, e.event.data, e.replayed])).toEqual([
      ["start", null, true],
      ["check", null, true],
      ["pay", { amount: 50 }, true],
    ]);
    // the edited guard declines the payment now
    expect(r.state.configuration).toEqual(["checkout", "cart"]);
    expect(r.state.context).toMatchObject({ total: 0, declined: 1 });
    expect(s.runs).toHaveLength(1);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Final state ends the run#Reach paid]] {level: integration}
  it("ends the run in a top-level final state", async () => {
    const s = await started();
    await s.send("start");
    const st = await s.send("pay", { amount: 150 });
    expect(st.done).toBe(true);
    expect(st.finalStates).toEqual(["paid"]);
    expect(await s.enabledEvents(["start", "pay"])).toEqual([]);
    await expect(s.send("start")).rejects.toBeInstanceOf(SimulationError);
    await expect(s.send("start")).rejects.toMatchObject({ code: "RunDone" });
    // time travel lifts the refusal: sending from step 1 forks
    await s.back();
    const forked = await s.send("cancel");
    expect(forked.finalStates).toEqual(["cancelled"]);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Send events with payload#Ill-typed payload is refused]] {level: integration}
  it("refuses an ill-typed payload without sending it", async () => {
    const s = open();
    const r = await s.start(fixture("typed-order.vt.yaml"), "yaml");
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.configuration).toEqual(["shopping", "cart"]);
    await s.send("add", { sku: "BOOK-1", qty: 1, price: "10" });
    await s.send("checkout");
    expect(s.state?.configuration).toEqual(["shopping", "payment"]);
    const bad = s.send("pay", { amount: "ten", method: { tag: "Invoice" } });
    await expect(bad).rejects.toBeInstanceOf(PayloadTypeError);
    await expect(bad).rejects.toMatchObject({ code: "PayloadType", message: expect.stringMatching(/amount.*decimal/) });
    expect(s.state?.head).toBe(2);
    const ok = await s.send("pay", { amount: "10", method: { tag: "Invoice" } });
    expect(ok.configuration).toEqual(["fulfilment"]);
  });

  it("appends macrosteps of delayed sends and notifies subscribers", async () => {
    const s = await started(`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="open">
  <state id="open"><transition event="pay" target="paid"><send event="ship" delay="100ms"/></transition></state>
  <state id="paid"><transition event="ship" target="shipped"/></state>
  <state id="shipped"/>
</scxml>`);
    const seen: (string | undefined)[] = [];
    const stop = s.onUpdate((st) => seen.push(st?.event?.name));
    await s.send("pay");
    await expect.poll(() => s.state?.configuration, { timeout: 5000 }).toEqual(["shipped"]);
    stop();
    expect(seen).toEqual(["pay", "ship"]);
    expect(s.log.map((e) => [e.event.name, e.event.origin])).toEqual([
      ["pay", "external"],
      ["ship", "timer"],
    ]);
  });

  it("follows a YAML chart with parallel regions", async () => {
    const s = open();
    const r = await s.start(fixture("traffic-light.vt.yaml"), "yaml");
    expect(r.ok).toBe(true);
    // eventless transitions follow the light within the initial macrostep
    expect(s.state?.configuration).toEqual(["operating", "light", "red", "crossing", "walk"]);
    const st = await s.send("fault");
    expect(st.configuration).toEqual(["flashing"]);
  });

  it("drives an ECMAScript chart on the ECMAScript build", async () => {
    const s = open();
    const r = await s.start(ECMA, "scxml");
    expect(r.ok).toBe(true);
    expect(s.state?.context).toEqual({ n: 1, tags: ["x"] });
    const st = await s.send("inc", { by: 5 });
    expect(st.context.n).toBe(6);
    expect(st.changed).toEqual(["n"]);
    expect((await s.send("go")).configuration).toEqual(["b"]);
  });
});
