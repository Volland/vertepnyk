import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChartDocument, EditError, type ChartModel, type Command, type ContentItem, type Format } from "../src/index.js";
import { fixture, fixtureNames, read, suiteFiles } from "./helpers.js";
import { sameItem } from "../src/content.js";

function sig(m: ChartModel, rename: (id: string) => string = (x) => x): string[] {
  return [...m.transitions.values()]
    .map((t) => `${rename(t.source)}|${t.events.join(" ")}|${t.targets.map(rename).join(" ")}|${t.cond ?? ""}|${t.type}|${t.actions.length}`)
    .sort();
}

function layoutSig(m: ChartModel): string {
  return JSON.stringify([...m.layout].sort());
}

function tlayoutSig(m: ChartModel): string[] {
  return [...m.transitionLayout].map(([id, l]) => {
    const t = m.transitions.get(id)!;
    return `${t.source}|${t.events.join(" ")}|${t.targets.join(" ")}|${t.cond ?? ""}|${JSON.stringify(l)}`;
  }).sort();
}

/** The effect each command must have on the model. */
function check(cmd: Command, a: ChartModel, b: ChartModel): void {
  const ctx = JSON.stringify(cmd);
  switch (cmd.type) {
    case "addState": {
      const st = b.states.get(cmd.id!);
      expect(st?.parent, ctx).toBe(cmd.parent);
      expect(st?.kind, ctx).toBe(cmd.kind);
      expect(sig(b), ctx).toEqual(sig(a));
      expect(layoutSig(b), ctx).toBe(layoutSig(a));
      expect(tlayoutSig(b), ctx).toEqual(tlayoutSig(a));
      break;
    }
    case "removeState": {
      const gone = new Set<string>();
      const walk = (x: string) => { gone.add(x); for (const c of a.states.get(x)!.children) walk(c); };
      walk(cmd.id);
      for (const g of gone) expect(b.states.has(g), ctx).toBe(false);
      expect(b.states.size, ctx).toBe(a.states.size - gone.size);
      for (const t of b.transitions.values()) for (const x of t.targets) expect(gone.has(x), ctx).toBe(false);
      for (const st of b.states.values()) for (const x of st.initial) expect(gone.has(x), ctx).toBe(false);
      for (const x of b.initial) expect(gone.has(x), ctx).toBe(false);
      break;
    }
    case "renameState": {
      if (cmd.id === cmd.newId) break;
      expect(b.states.has(cmd.id), ctx).toBe(false);
      expect(b.states.get(cmd.newId)?.kind, ctx).toBe(a.states.get(cmd.id)!.kind);
      const rn = (x: string) => (x === cmd.id ? cmd.newId : x);
      expect(sig(b), ctx).toEqual(sig(a, rn));
      expect(b.initial, ctx).toEqual(a.initial.map(rn));
      for (const st of a.states.values()) expect(b.states.get(rn(st.id))!.initial, ctx).toEqual(st.initial.map(rn));
      expect(b.layout.has(cmd.newId), ctx).toBe(a.layout.has(cmd.id));
      expect(b.transitionLayout.size, ctx).toBe(a.transitionLayout.size);
      break;
    }
    case "reparentState":
      expect(b.states.get(cmd.id)?.parent, ctx).toBe(cmd.parent);
      expect(b.states.size, ctx).toBe(a.states.size);
      expect(sig(b), ctx).toEqual(sig(a));
      if (cmd.index !== undefined) {
        const sibs = cmd.parent === null ? b.roots : b.states.get(cmd.parent)!.children;
        expect(sibs.indexOf(cmd.id), ctx).toBe(Math.min(cmd.index, sibs.length - 1));
      }
      expect(layoutSig(b), ctx).toBe(layoutSig(a));
      expect(tlayoutSig(b), ctx).toEqual(tlayoutSig(a));
      break;
    case "addTransition": {
      expect(b.transitions.size, ctx).toBe(a.transitions.size + 1);
      const want = `${cmd.source}|${(cmd.events ?? []).join(" ")}|${cmd.targets.join(" ")}|${cmd.cond ?? ""}|${cmd.transitionType ?? "external"}|0`;
      expect(sig(b), ctx).toEqual([...sig(a), want].sort());
      expect(layoutSig(b), ctx).toBe(layoutSig(a));
      expect(tlayoutSig(b), ctx).toEqual(tlayoutSig(a));
      break;
    }
    case "removeTransition": {
      const t = a.transitions.get(cmd.id)!;
      const gone = `${t.source}|${t.events.join(" ")}|${t.targets.join(" ")}|${t.cond ?? ""}|${t.type}|${t.actions.length}`;
      const want = sig(a);
      want.splice(want.indexOf(gone), 1);
      expect(sig(b), ctx).toEqual(want);
      break;
    }
    case "updateTransition": {
      const t = a.transitions.get(cmd.id)!;
      const old = `${t.source}|${t.events.join(" ")}|${t.targets.join(" ")}|${t.cond ?? ""}|${t.type}|${t.actions.length}`;
      const cond = cmd.cond === null ? "" : (cmd.cond ?? t.cond ?? "");
      const nw = `${cmd.source ?? t.source}|${(cmd.events ?? t.events).join(" ")}|${(cmd.targets ?? t.targets).join(" ")}|${cond}|${cmd.transitionType ?? t.type}|${t.actions.length}`;
      const want = sig(a);
      want.splice(want.indexOf(old), 1, nw);
      expect(sig(b), ctx).toEqual(want.sort());
      break;
    }
    case "setContent": {
      const got = "transition" in cmd.owner
        ? [...b.transitions.values()].filter((t) => t.source === a.transitions.get((cmd.owner as { transition: string }).transition)!.source).map((t) => t.actions)
        : [b.states.get(cmd.owner.state)![cmd.owner.slot].flatMap((x) => x.items)];
      const ok = got.some((items) => items.length === cmd.items.length && items.every((x, i) => sameItem(x, cmd.items[i]!)));
      expect(ok, ctx + "\n" + JSON.stringify(got)).toBe(true);
      expect(b.transitions.size, ctx).toBe(a.transitions.size);
      break;
    }
    case "addData":
      expect(b.data.find((d) => d.id === cmd.id)?.owner, ctx).toBe(cmd.owner);
      break;
    case "removeData":
      expect(b.data.length, ctx).toBe(a.data.length - 1);
      break;
    case "updateData": {
      const d = b.data.find((x) => x.id === (cmd.newId ?? cmd.id))!;
      expect(d, ctx).toBeDefined();
      if (cmd.expr !== undefined) expect(d.expr, ctx).toBe(cmd.expr ?? undefined);
      break;
    }
    case "setLayout":
      for (const [id, l] of Object.entries(cmd.states ?? {})) expect(b.layout.get(id) ?? null, ctx).toEqual(l);
      for (const [id, l] of Object.entries(cmd.transitions ?? {})) expect(b.transitionLayout.get(id) ?? null, ctx).toEqual(l);
      expect(sig(b), ctx).toEqual(sig(a));
      break;
    case "setStateKind":
      expect(b.states.get(cmd.id)!.kind, ctx).toBe(cmd.kind);
      expect(sig(b), ctx).toEqual(sig(a));
      break;
    case "setInitial":
      expect(cmd.state === null ? b.initial : b.states.get(cmd.state)!.initial, ctx).toEqual(cmd.initial);
      break;
    case "setChartProps":
      if (cmd.name !== undefined) expect(b.name, ctx).toBe(cmd.name ?? undefined);
      if (cmd.datamodel !== undefined) expect(b.datamodel, ctx).toBe(cmd.datamodel ?? undefined);
      break;
  }
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function pick<T>(r: (n: number) => number, xs: readonly T[]): T | undefined {
  return xs.length ? xs[r(xs.length)] : undefined;
}

export function randomCommand(r: (n: number) => number, m: ChartModel, n: number): Command | null {
  const states = [...m.states.keys()];
  const trans = [...m.transitions.keys()];
  const s = pick(r, states);
  const s2 = pick(r, states);
  const t = pick(r, trans);
  const items: ContentItem[] = [
    { kind: "raise", event: `e${n}` },
    { kind: "assign", location: "x", expr: "x + 1" },
    { kind: "log", label: "l", expr: "'a < b'" },
    { kind: "send", event: "go", delay: "1s", params: [{ name: "a", expr: "1" }] },
    { kind: "if", branches: [{ cond: "a", actions: [{ kind: "raise", event: "a" }] }, { actions: [{ kind: "cancel", sendid: "t" }] }] },
    { kind: "foreach", array: "xs", item: "x", actions: [{ kind: "raise", event: "each" }] },
  ];
  switch (r(16)) {
    case 0:
      return { type: "addState", parent: r(3) === 0 ? null : (s ?? null), kind: pick(r, ["atomic", "parallel", "final"] as const)!, id: `n${n}` };
    case 1:
      return s ? { type: "removeState", id: s } : null;
    case 2:
      return s ? { type: "renameState", id: s, newId: `r${n}` } : null;
    case 3:
      return s ? { type: "reparentState", id: s, parent: r(3) === 0 ? null : (s2 ?? null), ...(r(2) ? { index: r(3) } : {}) } : null;
    case 4:
      return s && s2 ? { type: "addTransition", source: s, targets: [s2], ...(r(2) ? { events: [pick(r, ["go", "tick", "stop"])!] } : {}), ...(r(2) ? { cond: "a < b" } : {}) } : null;
    case 5:
      return t ? { type: "removeTransition", id: t } : null;
    case 6:
      return t
        ? {
            type: "updateTransition",
            id: t,
            ...(r(2) && s2 ? { targets: [s2] } : {}),
            ...(r(2) ? { cond: r(2) ? null : "c > 1" } : {}),
            ...(r(3) === 0 ? { events: r(2) ? [] : ["press"] } : {}),
            ...(r(4) === 0 && s ? { source: s } : {}),
            ...(r(4) === 0 ? { transitionType: r(2) ? "internal" : "external" } : {}),
          }
        : null;
    case 7: {
      const its = items.filter(() => r(2) === 0);
      if (r(2) && t) return { type: "setContent", owner: { transition: t }, items: [...(m.transitions.get(t)!.actions), ...its] };
      if (!s) return null;
      const slot = r(2) ? "onentry" : "onexit";
      const cur = m.states.get(s)![slot].flatMap((b) => b.items);
      return { type: "setContent", owner: { state: s, slot }, items: r(3) === 0 ? cur.slice(1) : [...cur, ...its] };
    }
    case 8:
      return { type: "addData", owner: r(2) ? null : (s ?? null), id: `d${n}`, ...(r(2) ? { expr: "0" } : {}) };
    case 9: {
      const d = pick(r, m.data);
      return d ? (r(2) ? { type: "removeData", id: d.id } : { type: "updateData", id: d.id, expr: r(2) ? null : "42", ...(r(2) ? { newId: `dd${n}` } : {}) }) : null;
    }
    case 10:
    case 11:
      return {
        type: "setLayout",
        states: s ? { [s]: r(5) === 0 ? null : { x: r(500), y: r(500), w: 100, h: 60, ...(r(4) === 0 ? { collapsed: true } : {}) } } : {},
        transitions: t ? { [t]: r(4) === 0 ? null : { route: [[r(9), r(9)]], label: [1, 2] } } : {},
      };
    case 12:
      return s ? { type: "setStateKind", id: s, kind: pick(r, ["atomic", "compound", "parallel", "final", "history"] as const)! } : null;
    case 13:
      return { type: "setInitial", state: r(2) ? null : (s ?? null), initial: s2 && r(3) ? [s2] : [] };
    case 14:
      return { type: "setChartProps", ...(r(2) ? { name: r(3) ? `chart${n}` : null } : {}), ...(r(2) ? { datamodel: r(2) ? "cel" : null } : {}) };
    default:
      return s ? { type: "renameState", id: s, newId: `q${n}` } : null;
  }
}

const stats = new Map<string, [number, number]>();
describe("random command sequences", () => {
  const files: [string, Format][] = [
    ...fixtureNames(".scxml").map((f) => [f, "scxml"] as [string, Format]),
    ...fixtureNames(".vt.yaml").map((f) => [f, "yaml"] as [string, Format]),
  ];
  for (const [f, fmt] of files) {
    it(`${f}: every command keeps the text parseable and undo exact`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const r = rng(seed * 7919);
        const doc = ChartDocument.open(fixture(f), fmt);
        const texts = [doc.text];
        for (let n = 0; n < 40; n++) {
          const cmd = randomCommand(r, doc.model!, n);
          if (!cmd) continue;
          const before = doc.text;
          try {
            doc.apply(cmd);
          } catch (e) {
            const st = stats.get(cmd.type) ?? [0, 0];
            st[1]++;
            stats.set(cmd.type, st);
            if (process.env.FUZZ_STATS && e instanceof EditError) console.log(cmd.type, e.message);
            if (!(e instanceof EditError)) throw new Error(`seed ${seed} step ${n} ${JSON.stringify(cmd)}\n${before}\n${(e as Error).stack}`);
            expect(doc.text).toBe(before);
            continue;
          }
          expect(doc.error).toBeNull();
          const st = stats.get(cmd.type) ?? [0, 0];
          st[0]++;
          stats.set(cmd.type, st);
          if (doc.text !== before) texts.push(doc.text);
          try {
            check(cmd, ChartDocument.open(before, fmt).model!, doc.model!);
          } catch (e) {
            throw new Error(`seed ${seed} step ${n} ${JSON.stringify(cmd)}\n--- before\n${before}\n--- after\n${doc.text}\n${(e as Error).message}`);
          }
          // The model the document holds matches a fresh parse of its text.
          const fresh = ChartDocument.open(doc.text, fmt).model!;
          expect([...fresh.states.keys()]).toEqual([...doc.model!.states.keys()]);
        }
        for (let i = texts.length - 1; i > 0; i--) {
          expect(doc.text).toBe(texts[i]);
          doc.undo();
        }
        expect(doc.text).toBe(texts[0]);
      }
    });
  }
  const suite = suiteFiles(".txml");
  it.skipIf(suite.length === 0)("W3C suite documents: commands keep the text parseable, the model right and undo exact", () => {
    for (const f of suite) {
      const r = rng(f.length * 31);
      const doc = ChartDocument.open(read(f), "scxml");
      const texts = [doc.text];
      for (let n = 0; n < 25; n++) {
        const cmd = randomCommand(r, doc.model!, n);
        if (!cmd) continue;
        const before = doc.text;
        try {
          doc.apply(cmd);
        } catch (e) {
          if (!(e instanceof EditError)) throw new Error(`${f} step ${n} ${JSON.stringify(cmd)}\n${before}\n${(e as Error).stack}`);
          continue;
        }
        try {
          check(cmd, ChartDocument.open(before, "scxml").model!, doc.model!);
        } catch (e) {
          throw new Error(`${f} step ${n} ${JSON.stringify(cmd)}\n--- before\n${before}\n--- after\n${doc.text}\n${(e as Error).message}`);
        }
        if (doc.text !== before) texts.push(doc.text);
      }
      while (doc.undo());
      expect(doc.text).toBe(texts[0]);
    }
  });

  it("stats", () => {
    if (process.env.FUZZ_STATS) console.log(JSON.stringify([...stats]));
  });
});

const VT = process.env.VT_BIN ?? join(__dirname, "../../../../vertep/target/release/vt");

/** vt's verdict on a text, or null when it accepts it. */
function vtErrors(text: string, fmt: Format): string | null {
  const dir = mkdtempSync(join(tmpdir(), "vtnyk-"));
  const f = join(dir, fmt === "scxml" ? "c.scxml" : "c.vt.yaml");
  writeFileSync(f, text);
  try {
    execFileSync(VT, ["validate", f], { stdio: "pipe" });
    return null;
  } catch (e) {
    return String((e as { stdout?: Buffer }).stdout ?? "") + String((e as { stderr?: Buffer }).stderr ?? "");
  }
}

describe.skipIf(!existsSync(VT))("generated text is accepted by vertep (vt validate)", () => {
  const files: [string, Format][] = [
    ...fixtureNames(".scxml").map((f) => [f, "scxml"] as [string, Format]),
    ...fixtureNames(".vt.yaml").filter((f) => !f.includes("ill-typed")).map((f) => [f, "yaml"] as [string, Format]),
  ];
  for (const [f, fmt] of files) {
    it(`${f}`, () => {
      const errs: string[] = [];
      for (let seed = 1; seed <= 4; seed++) {
        const r = rng(seed * 104729);
        const doc = ChartDocument.open(fixture(f), fmt);
        for (let n = 0; n < 25; n++) {
          const cmd = randomCommand(r, doc.model!, n);
          if (!cmd || cmd.type === "setLayout" || (cmd.type === "addState" && cmd.layout)) continue;
          try {
            doc.apply(cmd);
          } catch {
            continue;
          }
          const err = vtErrors(doc.text, fmt);
          if (err) errs.push(`${JSON.stringify(cmd)}\n${err}`);
        }
      }
      expect(errs.join("\n\n")).toBe("");
    });
  }
});
