import { afterEach, describe, expect, it } from "vitest";
import { cleanup, open, until, type Mounted } from "./harness.js";
import { BAD_REVIEW, ORDER, WITH_FINAL, fixture } from "./charts.js";

afterEach(cleanup);

const stateEl = (m: Mounted, id: string) => m.q(`[data-state-id="${id}"]`);
const isActive = (m: Mounted, id: string) => stateEl(m, id)?.getAttribute("data-active") === "true";
const valid = (m: Mounted) => until(() => m.handle?.controller.state.validation.status === "valid");

async function started(text = ORDER, name = "chart.scxml"): Promise<Mounted> {
  const m = await open(text, name);
  await valid(m);
  m.click('[data-testid="tab-simulation"]');
  m.click('[data-testid="sim-start"]');
  await until(() => m.q('[data-testid="sim-config"] .vd-chip'));
  return m;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string): void {
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Sends through the form and waits until the run's head reaches `head`. */
async function send(m: Mounted, name: string, payload: string | undefined, head: number): Promise<void> {
  setValue(m.q<HTMLInputElement>('[data-testid="event-name"]')!, name);
  setValue(m.q<HTMLTextAreaElement>('[data-testid="event-payload"]')!, payload ?? "");
  m.click('[data-testid="send"]');
  await until(() => m.handle.controller.state.run?.head === head);
}

const ctxValue = (m: Mounted, key: string) => m.q(`[data-testid="context-row"][data-key="${key}"] .vd-ctxval`)?.textContent;
const changedKey = (m: Mounted, key: string) => m.q(`[data-testid="context-row"][data-key="${key}"]`)?.getAttribute("data-changed");

describe("simulation in the designer", () => {
  // @tg: verifies:: [[openspec:chart-simulation#Start and reset#Start shows the initial configuration]] {level: integration}
  it("highlights the initial state when a run starts", async () => {
    const m = await started();
    await until(() => isActive(m, "idle"));
    expect(isActive(m, "checkout")).toBe(false);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Start and reset#Invalid chart does not start]] {level: integration}
  it("does not start a chart with an unknown target and shows the violation", async () => {
    const bad = ORDER.replace('target="paid"', 'target="nowhere"');
    const m = await open(bad);
    m.click('[data-testid="toolbar-simulate"]');
    await until(() => m.q('[data-testid="problems-panel"] [data-testid="problem"]'));
    expect(m.handle.controller.state.run).toBeNull();
    expect(m.q('[data-testid="problem"]')!.textContent).toMatch(/nowhere/);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Active configuration is highlighted#Highlight after an event]] {level: integration}
  it("highlights checkout and cart after start, not idle, and marks the transition", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await until(() => isActive(m, "cart"));
    expect(isActive(m, "checkout")).toBe(true);
    expect(isActive(m, "idle")).toBe(false);
    const taken = await until(() => m.qa('[data-transition-id="idle#0"]').find((e) => e.getAttribute("data-taken") === "true"));
    expect(taken).toBeTruthy();
  });

  // @tg: verifies:: [[openspec:chart-simulation#Enabled events are offered#Enabled events in cart]] {level: integration}
  it("offers pay and cancel as enabled events in cart", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await until(() => m.qa('[data-testid="enabled-event"]').some((b) => b.dataset.event === "pay"));
    const names = m.qa('[data-testid="enabled-event"]').map((b) => b.dataset.event);
    expect(names).toContain("pay");
    expect(names).toContain("cancel");
    expect(names).not.toContain("start");
  });

  // @tg: verifies:: [[openspec:chart-simulation#Send events with payload#Guard uses the payload]] {level: integration}
  it("keeps the configuration when the guard on the payload is false", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await send(m, "pay", '{"amount": 0}', 2);
    await until(() => isActive(m, "cart"));
    expect(isActive(m, "paid")).toBe(false);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Send events with payload#Ill-typed payload is refused]] {level: integration}
  it("refuses an ill-typed payload and shows the type error", async () => {
    const m = await started(fixture("typed-order.vt.yaml"), "typed-order.vt.yaml");
    await send(m, "add", '{"sku":"BOOK-1","qty":1,"price":"10"}', 1);
    await send(m, "checkout", undefined, 2);
    setValue(m.q<HTMLInputElement>('[data-testid="event-name"]')!, "pay");
    setValue(m.q<HTMLTextAreaElement>('[data-testid="event-payload"]')!, '{"amount":"ten","method":{"tag":"Invoice"}}');
    m.click('[data-testid="send"]');
    const err = await until(() => m.q('[data-testid="sim-error"]'));
    expect(err.textContent).toMatch(/amount/);
    expect(m.handle.controller.state.run?.head).toBe(2);
  });

  it("reports a payload that is not JSON without sending", async () => {
    const m = await started();
    setValue(m.q<HTMLInputElement>('[data-testid="event-name"]')!, "start");
    setValue(m.q<HTMLTextAreaElement>('[data-testid="event-payload"]')!, "{nope");
    m.click('[data-testid="send"]');
    const err = await until(() => m.q('[data-testid="sim-error"]'));
    expect(err.textContent).toMatch(/not valid JSON/);
    expect(m.handle.controller.state.run?.head).toBe(0);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Context is shown#Assign shows in context]] {level: integration}
  it("shows total as 150, marked changed, after pay with amount 150", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await send(m, "pay", '{"amount": 150}', 2);
    await until(() => ctxValue(m, "total") === "150");
    expect(changedKey(m, "total")).toBe("true");
    expect(changedKey(m, "declined")).toBe("false");
  });

  // @tg: verifies:: [[openspec:chart-simulation#Event log#Raised event appears in the log]] {level: integration}
  it("lists a raised event as internal in the log", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await send(m, "check", undefined, 2);
    const internal = await until(() => m.q('[data-testid="log-entry"][data-step="2"] [data-testid="log-internal"]'));
    expect(internal.textContent).toMatch(/checked/);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Time travel#Step back]] {level: integration}
  it("shows the state after the second macrostep when stepping back", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await send(m, "check", undefined, 2);
    await send(m, "pay", '{"amount": 0}', 3);
    await until(() => ctxValue(m, "declined") === "1");
    m.click('[data-testid="step-back"]');
    await until(() => m.handle.controller.state.run?.step === 2);
    await until(() => ctxValue(m, "declined") === "0");
    expect(ctxValue(m, "checks")).toBe("1");
    expect(isActive(m, "cart")).toBe(true);
    expect(m.q<HTMLInputElement>('[data-testid="time-slider"]')!.value).toBe("2");
    expect(m.q('[data-testid="fork-hint"]')).toBeTruthy();
  });

  // @tg: verifies:: [[openspec:chart-simulation#Time travel#Fork from the past]] {level: integration}
  it("forks a new run when sending from step one and keeps the original", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    await send(m, "check", undefined, 2);
    m.click('[data-testid="step-back"]');
    await until(() => m.handle.controller.state.run?.step === 1);
    setValue(m.q<HTMLInputElement>('[data-testid="event-name"]')!, "cancel");
    m.click('[data-testid="send"]');
    await until(() => m.handle.controller.simulator.runs.length === 2);
    const picker = await until(() => m.q<HTMLSelectElement>('[data-testid="run-picker"]'));
    expect(picker.options.length).toBe(2);
    expect(picker.options[1]!.textContent).toMatch(/from step 1/);
    const [original, fork] = m.handle.controller.simulator.runs;
    expect(original!.head).toBe(2);
    expect(fork!.parent).toEqual({ runId: original!.id, step: 1 });
    // the original is still selectable
    picker.value = original!.id;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => m.handle.controller.state.run?.runId === original!.id);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Final state ends the run#Reach paid]] {level: integration}
  it("shows the run as done at a top-level final state and refuses sending", async () => {
    const m = await started(WITH_FINAL);
    await send(m, "finish", undefined, 1);
    const banner = await until(() => m.q('[data-testid="run-done"]'));
    expect(banner.textContent).toMatch(/done/);
    expect(m.q<HTMLButtonElement>('[data-testid="send"]')!.disabled).toBe(true);
  });

  // @tg: verifies:: [[openspec:chart-simulation#Live edits during simulation#Replay on edit]] {level: integration}
  it("offers a replay after an edit and replays the events", async () => {
    const m = await started();
    await send(m, "start", undefined, 1);
    m.handle.controller.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "extra" });
    const banner = await until(() => m.q('[data-testid="stale-banner"]'));
    banner.querySelector<HTMLElement>('[data-testid="sim-replay"]')!.click();
    await until(() => !m.q('[data-testid="stale-banner"]'));
    expect(m.handle.controller.state.run?.head).toBe(1);
  });
});

describe("problems in the designer", () => {
  // @tg: verifies:: [[openspec:chart-validation#Diagnostics are located#Reveal from the list]] {level: integration}
  it("selects and reveals the element of a violation chosen in the list", async () => {
    const m = await open(BAD_REVIEW);
    await until(() => m.handle.controller.state.validation.status === "invalid");
    m.click('[data-testid="tab-problems"]');
    const item = await until(() => m.qa('[data-testid="problem"]').find((p) => p.dataset.element === "review"));
    const revealed: unknown[] = [];
    (m.host as { revealText?: (s: unknown) => void }).revealText = (s) => revealed.push(s);
    item.click();
    await until(() => stateEl(m, "review")?.getAttribute("data-selected") === "true");
    expect(m.q('[data-testid="problem-count"]')).toBeTruthy();
    // the canvas draws the marker on the element
    expect(stateEl(m, "review")?.getAttribute("data-severity")).toBe("error");
    if (item.textContent && /\d+:\d+/.test(item.textContent)) expect(revealed.length).toBe(1);
  });

  it("shows a parse error with its position and makes the canvas read-only", async () => {
    const m = await open(ORDER);
    await valid(m);
    m.host.setExternalText("<scxml");
    const banner = await until(() => m.q('[data-testid="parse-error"]'));
    expect(banner.textContent).toMatch(/\d+:\d+/);
    expect(m.q<HTMLButtonElement>('[data-testid="toolbar-simulate"]')!.disabled).toBe(true);
    m.host.setExternalText(ORDER);
    await until(() => !m.q('[data-testid="parse-error"]'));
  });

  it("shows the version IRI when valid, and Ctrl+S saves through the host", async () => {
    const m = await open(ORDER);
    await valid(m);
    expect(m.q('[data-testid="version-badge"]')!.getAttribute("title")).toMatch(/^urn:vertep:chart:sha256:/);
    m.handle.controller.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "extra" });
    await until(() => !m.host.saved);
    m.q('.vd-root')!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    await until(() => m.host.saved);
  });
});
