import { afterEach, describe, expect, it } from "vitest";
import { Simulator, Validator, debounce, liveValidation } from "../src/index.js";
import { ECMA, UNKNOWN_TARGET, fixture } from "./charts.js";

let validator: Validator;
const open = () => {
  validator = new Validator();
  return validator;
};
afterEach(async () => {
  await validator?.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("chart validation on vertep", () => {
  // @tg: verifies:: [[openspec:chart-validation#Validation runs on vertep#Unknown target]] {level: integration}
  it("reports vertep's violation for an unknown target", async () => {
    const v = open();
    const r = await v.validate(UNKNOWN_TARGET, "scxml");
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.violations).toEqual([
      {
        code: "ChartInvalid",
        severity: "error",
        message: "transition target names unknown state `missing`",
        line: 2,
        column: 17,
        raw: { message: "transition target names unknown state `missing`", line: 2, column: 17 },
      },
    ]);
    const yaml = await v.validate("vertep: 1\nname: x\ninitial: a\nstates:\n  a:\n    on: { go: nowhere }\n", "yaml");
    expect(yaml.status === "invalid" && yaml.violations[0]).toMatchObject({
      message: "unknown target `nowhere`",
      line: 6,
      path: "states.a.on.go.target",
      stateId: "a",
      transition: { source: "a", event: "go" },
    });
  });

  it("locates type errors by state and transition", async () => {
    const v = open();
    const r = await v.validate(fixture("typed-order-ill-typed.vt.yaml"), "yaml");
    expect(r.status).toBe("invalid");
    if (r.status !== "invalid") return;
    expect(r.violations[0]).toMatchObject({
      line: 44,
      path: "states.shopping.states.cart.on.add[0].actions[1]",
      stateId: "cart",
      transition: { source: "cart", index: 0, event: "add" },
    });
    expect(r.violations[0]?.message).toMatch(/has type string, expected decimal/);
    const core = await v.validate(
      `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="a"><state id="a" initial="b"><state id="c"/></state><state id="b"/></scxml>`,
      "scxml",
    );
    expect(core.status === "invalid" && core.violations[0]).toMatchObject({ rule: "IllegalInitialTarget", stateId: "a" });
  });

  // @tg: verifies:: [[openspec:chart-validation#Continuous validation#Results follow the latest text]] {level: integration}
  it("reports only the diagnostics of the latest text", async () => {
    const v = open();
    const valid = fixture("order.scxml");
    // two edits in flight: the older resolves stale
    const [first, second] = await Promise.all([v.validate(UNKNOWN_TARGET, "scxml"), v.validate(valid, "scxml")]);
    expect(first.status).toBe("stale");
    expect(second.status).toBe("valid");
    expect(second.seq).toBeGreaterThan(first.seq);

    // two edits within the debounce window: one validation, of the second text
    const results: string[] = [];
    const live = liveValidation(v, { onResult: (r) => results.push(r.status) }, 30);
    live.update(UNKNOWN_TARGET, "scxml");
    await sleep(5);
    live.update(valid, "scxml");
    await sleep(30);
    await expect.poll(() => results, { timeout: 5000 }).toEqual(["valid"]);
    await sleep(50);
    expect(results).toEqual(["valid"]);
  });

  it("debounces calls to the latest arguments", async () => {
    const seen: number[] = [];
    const d = debounce((n: number) => seen.push(n), 20);
    d(1);
    d(2);
    expect(d.pending).toBe(true);
    await sleep(40);
    d(3);
    d.cancel();
    d(4);
    d.flush();
    expect(seen).toEqual([2, 4]);
  });

  // @tg: verifies:: [[openspec:chart-validation#Datamodel-aware checks#ECMAScript chart]] {level: integration}
  it("validates and simulates an ECMAScript chart with the ECMAScript build", async () => {
    const v = open();
    const r = await v.validate(ECMA, "scxml");
    expect(r).toMatchObject({ status: "valid", datamodel: "ecmascript", build: "ecmascript" });
    const typed = await v.validate(fixture("typed-order.vt.yaml"), "yaml");
    expect(typed).toMatchObject({ status: "valid", datamodel: "cel", build: "default" });
    const sim = new Simulator();
    try {
      const s = await sim.start(ECMA, "scxml");
      expect(s.ok).toBe(true);
      // the ECMAScript engine's own context encoding, decoded: only the ECMAScript build runs it
      expect((await sim.send("inc", { by: 2 })).context).toEqual({ n: 3, tags: ["x"] });
      expect((await sim.send("go")).configuration).toEqual(["b"]);
    } finally {
      await sim.dispose();
    }
  });

  // @tg: verifies:: [[openspec:chart-validation#Content hash shown#Hash follows semantic edits only]] {level: integration}
  it("changes the version IRI on a guard change, not on formatting", async () => {
    const v = open();
    const text = fixture("order.scxml");
    const a = await v.validate(text, "scxml");
    const guarded = await v.validate(text.replace('cond="ctx.items > 0"', 'cond="ctx.items > 1"'), "scxml");
    const reformatted = await v.validate(text.replace("<state id=\"paid\"/>", "<!-- moved -->\n  <state  id=\"paid\" />"), "scxml");
    expect(a.status).toBe("valid");
    expect(guarded.status).toBe("valid");
    if (a.status !== "valid" || guarded.status !== "valid" || reformatted.status !== "valid") throw new Error("invalid");
    expect(a.version).toMatch(/^urn:vertep:chart:sha256:[0-9a-f]{64}$/);
    expect(guarded.version).not.toBe(a.version);
    expect(reformatted.version).toBe(a.version);
  });

  // Moving a state writes `vl:x`/`vl:y` (design D3); vertep's layout namespace (milestone M0)
  // keeps them out of the version IRI.
  it("does not change the version IRI when a state moves", async () => {
    const v = open();
    const text = fixture("order.scxml").replace(
      "<scxml ",
      '<scxml xmlns:vl="https://w3id.org/vertep/layout#" ',
    );
    const a = await v.validate(text.replace('<state id="paid"/>', '<state id="paid" vl:x="10" vl:y="20"/>'), "scxml");
    const b = await v.validate(text.replace('<state id="paid"/>', '<state id="paid" vl:x="99" vl:y="20"/>'), "scxml");
    expect(a.status === "valid" && b.status === "valid" && a.version === b.version).toBe(true);
  });
});
