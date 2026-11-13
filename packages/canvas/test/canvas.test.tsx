import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ChartDocument } from "@vertepnyk/core";
import { copySelection, generateChart, pasteSelection } from "../src/index.js";
import { DARK_THEME, click, key, mount, place, pointer, scxml, stateEl, type Mounted } from "./helpers.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const mounted: Mounted[] = [];
function open(text: string, extra: Parameters<typeof mount>[1] = {}): { doc: ChartDocument; m: Mounted } {
  const doc = ChartDocument.open(text, "scxml");
  const m = mount(doc, extra);
  mounted.push(m);
  return { doc, m };
}
afterEach(() => {
  while (mounted.length) mounted.pop()!.dispose();
});

describe("scene", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Every SCXML state kind is drawn#Parallel state]] {level: unit}
  it("draws parallel regions separated inside the parallel state", () => {
    const doc = ChartDocument.open(
      scxml(`<parallel id="checkout"><state id="payment"/><state id="shipping"/></parallel>`),
      "scxml",
    );
    place(doc, { checkout: [0, 0, 400, 200], payment: [16, 52, 160, 100], shipping: [220, 52, 160, 100] });
    const m = mount(doc);
    mounted.push(m);
    const par = stateEl(m, "checkout");
    expect(par.getAttribute("data-kind")).toBe("parallel");
    expect(par.querySelectorAll("[data-separator]").length).toBe(1);
    expect(stateEl(m, "payment")).toBeTruthy();
    expect(stateEl(m, "shipping")).toBeTruthy();
    const sep = par.querySelector("[data-separator]")!.getAttribute("d")!;
    // The separator lies between the two regions (x between 176 and 220).
    const x = Number(sep.slice(1).split(" ")[0]);
    expect(x).toBeGreaterThan(176);
    expect(x).toBeLessThan(220);
  });

  // @tg: verifies:: [[openspec:canvas-editing#Every SCXML state kind is drawn#History state]] {level: unit}
  it("draws deep history distinct from shallow history", () => {
    const { m } = open(scxml(`<state id="p" initial="a"><state id="a"/><history id="hs"/><history id="hd" type="deep"/></state>`));
    const deep = stateEl(m, "hd").querySelector("[data-history-marker]")!;
    const shallow = stateEl(m, "hs").querySelector("[data-history-marker]")!;
    expect(deep.getAttribute("data-history-marker")).toBe("deep");
    expect(deep.textContent).toBe("H*");
    expect(shallow.getAttribute("data-history-marker")).toBe("shallow");
    expect(shallow.textContent).toBe("H");
  });

  it("draws final states as a double box and a dot-and-arrow for the initial state", () => {
    const { m } = open(scxml(`<state id="a"><transition event="done" target="z"/></state><final id="z"/>`, "a"));
    expect(stateEl(m, "z").querySelectorAll("rect").length).toBe(2);
    expect(m.container.querySelectorAll("[data-initial]").length).toBeGreaterThan(0);
  });

  // @tg: verifies:: [[openspec:canvas-editing#Transitions are drawn with their labels#Guarded transition label]] {level: unit}
  it("labels a guarded transition with its event and condition", () => {
    const { m } = open(scxml(`<state id="a"><transition event="authorized" cond="total &gt; 100" target="b"/></state><state id="b"/>`));
    const label = m.container.querySelector(".vt-edges [data-transition-id='a#0'] [data-edge-label]")!;
    expect(label.textContent).toBe("authorized [total > 100]");
  });

  it("marks eventless transitions and draws multi-target transitions as several arrows", () => {
    const { m } = open(scxml(`<state id="a"><transition target="b"/><transition event="go" target="b c"/></state><state id="b"/><state id="c"/>`));
    expect(m.container.querySelector("[data-transition-id='a#0']")!.getAttribute("data-eventless")).toBe("true");
    expect(m.container.querySelector("[data-transition-id='a#0'] [data-edge-label]")!.textContent).toBe("∅");
    expect(m.container.querySelectorAll("[data-transition-id='a#1'] .vt-line").length).toBe(2);
  });

  // @tg: verifies:: [[openspec:canvas-editing#Transitions are drawn with their labels#Targetless transition]] {level: unit}
  it("draws a targetless transition as an internal handler on its source", () => {
    const { m } = open(scxml(`<state id="a"><transition event="tick"/></state><state id="b"/>`));
    expect(m.container.querySelectorAll(".vt-edges [data-transition-id]").length).toBe(0);
    const badge = stateEl(m, "a").querySelector("[data-internal='true']")!;
    expect(badge.textContent).toContain("tick");
  });

  it("loads the order fixture and draws all of its states and transitions", () => {
    const { doc, m } = open(readFileSync(join(FIXTURES, "order.scxml"), "utf8"));
    expect(doc.model!.states.size).toBe(4);
    expect(m.container.querySelectorAll("[data-state-id]").length).toBe(4);
    expect(m.container.querySelectorAll(".vt-edges [data-transition-id]").length).toBe(3);
  });

  it("highlights active states and taken transitions per element", () => {
    const { m } = open(scxml(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), {
      active: new Set(["b"]),
      taken: new Set(["a#0"]),
    });
    expect(stateEl(m, "b").getAttribute("data-active")).toBe("true");
    expect(stateEl(m, "a").getAttribute("data-active")).toBe("false");
    expect(m.container.querySelector(".vt-edges [data-transition-id='a#0']")!.getAttribute("data-taken")).toBe("true");
  });
});

describe("editing", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Create states#Create a nested state]] {level: unit}
  it("creates a nested state with a double-click inside a compound state", () => {
    const doc = ChartDocument.open(scxml(`<state id="checkout" initial="cart"><state id="cart"/></state>`), "scxml");
    place(doc, { checkout: [0, 0, 400, 300], cart: [16, 52, 100, 40] });
    const m = mount(doc);
    mounted.push(m);
    pointer(stateEl(m, "checkout").querySelector(".vt-box")!, "dblclick", 250, 200);
    const created = doc.model!.states.get("state");
    expect(created?.parent).toBe("checkout");
    expect(doc.model!.states.get("checkout")!.children).toContain("state");
    expect(doc.text).toContain(`id="state"`);
    expect(new Set(doc.model!.states.keys()).size).toBe(3);
    expect(m.selection()).toEqual(["state"]);
  });

  it("creates every state kind through the api with unique ids", () => {
    const { doc, m } = open(scxml(`<state id="a"/>`));
    const api = m.api();
    let compound: string | null = null;
    const ids0 = (): string | null => compound;
    const ids = [
      api.createState("atomic", { at: { x: 200, y: 20 }, parent: null }),
      api.createState("atomic", { at: { x: 200, y: 80 }, parent: null }),
      (compound = api.createState("compound", { at: { x: 200, y: 140 }, parent: null })),
      api.createState("parallel", { at: { x: 200, y: 300 }, parent: null }),
      api.createState("final", { at: { x: 200, y: 460 }, parent: null }),
      api.createState("history", { at: { x: 220, y: 160 }, parent: ids0(), historyType: "deep" }),
    ];
    expect(new Set(ids).size).toBe(6);
    expect(doc.model!.states.get(ids[5]!)!.historyType).toBe("deep");
    expect(doc.model!.states.get(ids[2]!)!.kind).toBe("compound");
  });

  // @tg: verifies:: [[openspec:canvas-editing#Create and retarget transitions#Draw a transition]] {level: unit}
  it("draws a transition by dragging from a port to another state", () => {
    const doc = ChartDocument.open(scxml(`<state id="cart"/><state id="payment"/>`), "scxml");
    place(doc, { cart: [20, 20, 120, 40], payment: [300, 20, 120, 40] });
    const requested = vi.fn();
    const m = mount(doc, { onRequestTransitionDetails: requested });
    mounted.push(m);
    click(stateEl(m, "cart"), 40, 40);
    const port = m.container.querySelector("[data-port='cart']")!;
    pointer(port, "pointerdown", 140, 40);
    pointer(m.svg, "pointermove", 250, 40);
    expect(m.container.querySelector("[data-draft]")).toBeTruthy();
    pointer(m.svg, "pointermove", 350, 40);
    pointer(m.svg, "pointerup", 350, 40);
    expect(requested).toHaveBeenCalledWith("cart#0");
    // The host (inspector) then sets the event.
    doc.apply({ type: "updateTransition", id: "cart#0", events: ["pay"] });
    const t = doc.model!.transitions.get("cart#0")!;
    expect(t.source).toBe("cart");
    expect(t.events).toEqual(["pay"]);
    expect(t.targets).toEqual(["payment"]);
    expect(m.container.querySelector(".vt-edges [data-transition-id='cart#0'] [data-edge-label]")!.textContent).toBe("pay");
  });

  it("retargets a transition by dragging its end", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"><transition event="go" target="b"/></state><state id="b"/><state id="c"/>`), "scxml");
    place(doc, { a: [20, 20, 120, 40], b: [300, 20, 120, 40], c: [300, 200, 120, 40] });
    const m = mount(doc, { selection: ["a#0"] });
    mounted.push(m);
    const end = m.container.querySelector("[data-end='target']")!;
    pointer(end, "pointerdown", 300, 40);
    pointer(m.svg, "pointermove", 350, 150);
    pointer(m.svg, "pointermove", 350, 220);
    pointer(m.svg, "pointerup", 350, 220);
    expect(doc.model!.transitions.get("a#0")!.targets).toEqual(["c"]);
  });

  it("sets the initial child of a compound state", () => {
    const { doc, m } = open(scxml(`<state id="p" initial="a"><state id="a"/><state id="b"/></state>`));
    expect(m.api().setInitial("b")).toBe(true);
    expect(doc.model!.states.get("p")!.initial).toEqual(["b"]);
  });

  // @tg: verifies:: [[openspec:canvas-editing#Reparent states#Move into own descendant is refused]] {level: unit}
  it("refuses to drop a compound state into its own descendant and leaves the text unchanged", () => {
    const doc = ChartDocument.open(
      scxml(`<state id="checkout" initial="cart"><state id="cart" initial="x"><state id="x"/></state></state>`),
      "scxml",
    );
    place(doc, { checkout: [0, 0, 400, 300], cart: [16, 52, 300, 200], x: [16, 52, 100, 40] });
    const onError = vi.fn();
    const m = mount(doc, { onError });
    mounted.push(m);
    const before = doc.text;
    pointer(stateEl(m, "checkout").querySelector(".vt-box")!, "pointerdown", 350, 20);
    pointer(m.svg, "pointermove", 300, 100);
    pointer(m.svg, "pointermove", 250, 200);
    pointer(m.svg, "pointerup", 250, 200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![1].code).toBe("Cycle");
    expect(doc.text).toBe(before);
    expect(doc.model!.states.get("checkout")!.parent).toBeNull();
  });

  it("moves a state in one undo step and reparents it into a container", () => {
    const doc = ChartDocument.open(scxml(`<state id="box" initial="k"><state id="k"/></state><state id="s"/>`), "scxml");
    place(doc, { box: [0, 0, 300, 200], k: [16, 52, 100, 40], s: [400, 20, 100, 40] });
    const m = mount(doc);
    mounted.push(m);
    const before = doc.text;
    pointer(stateEl(m, "s").querySelector(".vt-box")!, "pointerdown", 450, 40);
    pointer(m.svg, "pointermove", 300, 120);
    pointer(m.svg, "pointermove", 200, 150);
    pointer(m.svg, "pointerup", 200, 150);
    expect(doc.model!.states.get("s")!.parent).toBe("box");
    expect(doc.undo()).toBe(true);
    expect(doc.text).toBe(before);
  });

  // @tg: verifies:: [[openspec:canvas-editing#Delete elements#Delete a targeted state]] {level: unit}
  it("tells how many transitions a delete removes and removes them after confirmation", async () => {
    const doc = ChartDocument.open(
      scxml(`<state id="a"><transition event="x" target="review"/></state><state id="b"><transition event="y" target="review"/><transition event="z" target="a"/></state><state id="review"/>`),
      "scxml",
    );
    const confirm = vi.fn(() => true);
    const m = mount(doc, { confirmDelete: confirm });
    mounted.push(m);
    click(stateEl(m, "review"), 0, 0);
    expect(m.selection()).toEqual(["review"]);
    key(m.svg, "Delete");
    await vi.waitFor(() => expect(doc.model!.states.has("review")).toBe(false));
    expect(confirm).toHaveBeenCalledTimes(1);
    const info = confirm.mock.calls[0]![0] as { states: string[]; transitions: string[] };
    expect(info.states).toEqual(["review"]);
    expect(info.transitions.length).toBe(2);
    expect([...doc.model!.transitions.values()].every((t) => !t.targets.includes("review"))).toBe(true);
    expect(doc.model!.transitions.size).toBe(1);
  });

  it("keeps the chart when the delete is not confirmed", async () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/>`), "scxml");
    const m = mount(doc, { confirmDelete: () => false });
    mounted.push(m);
    click(stateEl(m, "a"), 0, 0);
    expect(await m.api().deleteSelection()).toBe(false);
    expect(doc.model!.states.has("a")).toBe(true);
  });

  it("renames a state inline with F2", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), "scxml");
    const m = mount(doc);
    mounted.push(m);
    click(stateEl(m, "b"), 0, 0);
    key(m.svg, "F2");
    const input = m.container.querySelector("input.vt-rename") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "done";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(doc.model!.states.has("done")).toBe(true);
    expect(doc.model!.transitions.get("a#0")!.targets).toEqual(["done"]);
    expect(m.container.querySelector("input.vt-rename")).toBeNull();
  });

  it("reports a refused rename through onError", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/>`), "scxml");
    const onError = vi.fn();
    const m = mount(doc, { onError });
    mounted.push(m);
    click(stateEl(m, "b"), 0, 0);
    key(m.svg, "F2");
    const input = m.container.querySelector("input.vt-rename") as HTMLInputElement;
    input.value = "a";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("selects with a marquee and with shift-click", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/><state id="c"/>`), "scxml");
    place(doc, { a: [20, 20, 100, 40], b: [20, 100, 100, 40], c: [400, 400, 100, 40] });
    const m = mount(doc);
    mounted.push(m);
    pointer(m.svg, "pointerdown", 0, 0);
    pointer(m.svg, "pointermove", 10, 10);
    pointer(m.svg, "pointermove", 200, 200);
    pointer(m.svg, "pointerup", 200, 200);
    expect([...m.selection()].sort()).toEqual(["a", "b"]);
    click(stateEl(m, "c"), 420, 420, { shiftKey: true });
    expect([...m.selection()].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("clipboard", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Selection and clipboard#Paste keeps ids unique]] {level: unit}
  it("pastes a copied state under a different id", async () => {
    const doc = ChartDocument.open(scxml(`<state id="cart"/><state id="other"/>`), "scxml");
    const m = mount(doc);
    mounted.push(m);
    click(stateEl(m, "cart"), 0, 0);
    await m.api().copy();
    await m.api().paste();
    const ids = [...doc.model!.states.keys()];
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("cart");
    expect(m.selection()[0]).not.toBe("cart");
  });

  it("copies states with their internal transitions only", () => {
    const doc = ChartDocument.open(
      scxml(`<state id="p" initial="a"><state id="a"><transition event="go" target="b"/><transition event="out" target="z"/></state><state id="b"/></state><state id="z"/>`),
      "scxml",
    );
    const payload = copySelection(doc.model!, ["p"]);
    expect(payload.states.map((s) => s.id)).toEqual(["p", "a", "b"]);
    expect(payload.transitions.length).toBe(1);
    const res = pasteSelection(doc.model!, payload, { parent: null });
    doc.apply(res.commands);
    const m = doc.model!;
    expect(res.idMap.get("p")).toBe("p_1");
    expect(m.states.get("p_1")!.children).toEqual(["a_1", "b_1"]);
    expect(m.states.get("p_1")!.initial).toEqual(["a_1"]);
    expect(m.states.get("a_1")!.transitions.length).toBe(1);
    expect(m.transitions.get("a_1#0")!.targets).toEqual(["b_1"]);
  });

  it("cut removes the states and paste restores them with their ids", async () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/>`), "scxml");
    const m = mount(doc);
    mounted.push(m);
    click(stateEl(m, "a"), 0, 0);
    await m.api().cut();
    await vi.waitFor(() => expect(doc.model!.states.has("a")).toBe(false));
    await m.api().paste();
    expect(doc.model!.states.has("a")).toBe(true);
  });
});

describe("navigation", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Navigation#Collapse a compound state]] {level: unit}
  it("draws a collapsed compound state as one box with edges ending at its border", () => {
    const doc = ChartDocument.open(
      scxml(
        `<state id="start"><transition event="go" target="cart"/></state><state id="checkout" initial="cart"><state id="cart"/><state id="pay"/></state>`,
      ),
      "scxml",
    );
    place(doc, { start: [20, 20, 100, 40], checkout: [300, 20, 300, 200], cart: [16, 52, 100, 40], pay: [150, 52, 100, 40] });
    const m = mount(doc);
    mounted.push(m);
    expect(stateEl(m, "cart")).toBeTruthy();
    pointer(stateEl(m, "checkout").querySelector("[data-toggle]")!, "pointerdown", 580, 37);
    expect(doc.model!.layout.get("checkout")!.collapsed).toBe(true);
    expect(m.container.querySelector("[data-state-id='cart']")).toBeNull();
    expect(m.container.querySelector("[data-state-id='pay']")).toBeNull();
    expect(stateEl(m, "checkout").getAttribute("data-collapsed")).toBe("true");
    const path = m.container.querySelector(".vt-edges [data-transition-id='start#0'] .vt-line")!.getAttribute("d")!;
    const nums = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const endX = nums[nums.length - 2]!;
    expect(endX).toBeCloseTo(300, 0); // the left border of the collapsed box
    // expanding brings the children back
    pointer(stateEl(m, "checkout").querySelector("[data-toggle]")!, "pointerdown", 580, 37);
    expect(m.container.querySelector("[data-state-id='cart']")).toBeTruthy();
  });

  it("zooms with ctrl-wheel, pans with the wheel and fits the chart", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/>`), "scxml");
    place(doc, { a: [0, 0, 100, 40], b: [1000, 600, 100, 40] });
    const m = mount(doc);
    mounted.push(m);
    const pinch = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 0, clientY: 0 });
    Object.defineProperty(pinch, "ctrlKey", { value: true });
    m.svg.dispatchEvent(pinch);
    expect(m.viewport().zoom).toBeGreaterThan(1);
    m.svg.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 10, deltaY: 20 }));
    m.api().fit();
    expect(m.viewport().zoom).toBeLessThan(1);
    m.api().zoomToSelection();
    expect(m.viewport().zoom).toBeGreaterThan(0);
    m.api().centerOn("b");
    const v = m.viewport();
    expect(1050 * v.zoom + v.x).toBeCloseTo(400, 0);
  });

  it("exports every element as a standalone svg", () => {
    const { m } = open(scxml(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`));
    const svg = m.api().exportSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("xmlns=");
    expect(svg).toContain("viewBox");
    expect(svg).toContain(`data-state-id="a"`);
  });

  it("supports panning with space-drag", () => {
    const { m } = open(scxml(`<state id="a"/>`));
    key(m.svg, " ");
    pointer(m.svg, "pointerdown", 10, 10);
    pointer(m.svg, "pointermove", 60, 40);
    pointer(m.svg, "pointerup", 60, 40);
    expect(m.viewport().x).toBe(50);
    expect(m.viewport().y).toBe(30);
    m.svg.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  });
});

describe("theming", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Host theming#Theme switch]] {level: unit}
  it("switches theme without remounting and keeps selection and viewport", () => {
    const doc = ChartDocument.open(scxml(`<state id="a"/><state id="b"/>`), "scxml");
    const m = mount(doc, { selection: undefined });
    mounted.push(m);
    m.setViewport({ x: 30, y: 40, zoom: 1.5 });
    click(stateEl(m, "a"), 0, 0);
    const el = stateEl(m, "a");
    const root = m.container.querySelector(".vt-root") as HTMLElement;
    const lightBg = root.getAttribute("style");
    const transform = m.container.querySelector(".vt-viewport")!.getAttribute("transform");
    m.setTheme(DARK_THEME);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("style")).not.toBe(lightBg);
    expect(root.getAttribute("style")).toContain(DARK_THEME.background);
    expect(stateEl(m, "a")).toBe(el);
    expect(el.getAttribute("data-selected")).toBe("true");
    expect(m.selection()).toEqual(["a"]);
    expect(m.container.querySelector(".vt-viewport")!.getAttribute("transform")).toBe(transform);
    expect(m.viewport()).toEqual({ x: 30, y: 40, zoom: 1.5 });
  });
});

describe("accessibility", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Accessible canvas#Screen reader names a state]] {level: unit}
  it("names the focused state by kind and id", () => {
    const doc = ChartDocument.open(scxml(`<state id="checkout" initial="cart"><state id="cart"><transition event="pay" target="paid"/></state></state><state id="paid"/>`), "scxml");
    const m = mount(doc);
    mounted.push(m);
    click(stateEl(m, "cart"), 0, 0);
    key(m.svg, "ArrowLeft");
    const stop = m.container.querySelectorAll("[tabindex='0']");
    expect(stop.length).toBe(1);
    expect(stop[0]!.getAttribute("aria-label")).toBe("compound state checkout");
    key(m.svg, "ArrowRight");
    expect(m.container.querySelector("[tabindex='0']")!.getAttribute("aria-label")).toBe("atomic state cart");
    key(m.svg, "t");
    expect(m.container.querySelector("[tabindex='0']")!.getAttribute("aria-label")).toBe("transition from cart to paid on pay");
    key(m.svg, "ArrowLeft");
    expect(m.container.querySelector("[tabindex='0']")!.getAttribute("aria-label")).toBe("atomic state cart");
    expect(m.svg.getAttribute("role")).toBe("application");
  });

  it("announces diagnostics in a polite live region and marks the element", () => {
    const { m } = open(scxml(`<state id="a"/>`), { diagnostics: new Map([["a", { severity: "error" as const, message: "unreachable" }]]) });
    const live = m.container.querySelector("[aria-live='polite']")!;
    expect(live.textContent).toContain("unreachable");
    expect(stateEl(m, "a").getAttribute("data-severity")).toBe("error");
  });

  it("escape clears the selection", () => {
    const { m } = open(scxml(`<state id="a"/>`));
    click(stateEl(m, "a"), 0, 0);
    expect(m.selection()).toEqual(["a"]);
    key(m.svg, "Escape");
    expect(m.selection()).toEqual([]);
  });
});

describe("large charts", () => {
  // @tg: verifies:: [[openspec:canvas-editing#Rendering performance]] {level: unit}
  it("mounts only the visible part of a 1,000-state chart", () => {
    const text = generateChart(1000, 2000);
    const doc = ChartDocument.open(text, "scxml");
    expect(doc.model!.states.size).toBe(1000);
    expect(doc.model!.transitions.size).toBe(2000);
    const m = mount(doc);
    mounted.push(m);
    const states = m.container.querySelectorAll("[data-state-id]").length;
    const edges = m.container.querySelectorAll(".vt-edges > [data-transition-id]").length;
    expect(states).toBeGreaterThan(0);
    expect(states).toBeLessThan(250);
    expect(edges).toBeLessThan(500);
    expect(m.container.querySelectorAll("svg *").length).toBeLessThan(4000);
    // panning far away swaps the mounted subset without mounting everything
    m.setViewport({ x: -3000, y: -2000, zoom: 1 });
    expect(m.container.querySelectorAll("[data-state-id]").length).toBeLessThan(250);
  });
});

describe("layout fallback", () => {
  it("shows states at provisional positions, then applies the layout client's result", async () => {
    const { createInProcessLayout } = await import("@vertepnyk/layout");
    const doc = ChartDocument.open(scxml(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), "scxml");
    const client = createInProcessLayout();
    const m = mount(doc, { layoutClient: client });
    mounted.push(m);
    expect(stateEl(m, "a").getAttribute("data-provisional")).toBe("true");
    await vi.waitFor(() => expect(doc.model!.layout.size).toBe(2), { timeout: 5000 });
    expect(stateEl(m, "a").getAttribute("data-provisional")).toBe("false");
    expect(doc.undo()).toBe(true);
  });
});
