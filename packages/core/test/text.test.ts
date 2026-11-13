import { describe, expect, it } from "vitest";
import { applyPatches, composePatches, invertPatches, mapOffset } from "../src/text.js";
import type { TextPatch } from "../src/model.js";

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

function randomPatches(r: (n: number) => number, text: string): TextPatch[] {
  const out: TextPatch[] = [];
  let pos = 0;
  while (pos <= text.length && out.length < 4) {
    const start = pos + r(Math.max(1, text.length - pos + 1));
    if (start > text.length) break;
    const end = Math.min(text.length, start + r(4));
    out.push({ start, end, text: "xyz".slice(0, r(4)) });
    pos = end + 1;
  }
  return out;
}

describe("patch algebra", () => {
  it("composes, inverts and maps offsets consistently (property)", () => {
    const r = rng(42);
    for (let n = 0; n < 500; n++) {
      const original = "abcdefghijklmnop".slice(0, r(17));
      let acc: TextPatch[] = [];
      let current = original;
      for (let k = 0; k < 4; k++) {
        const next = randomPatches(r, current);
        acc = composePatches(original, acc, next);
        current = applyPatches(current, next);
        expect(applyPatches(original, acc)).toBe(current);
      }
      expect(applyPatches(current, invertPatches(original, acc))).toBe(original);
    }
  });

  it("maps offsets outside patches and refuses offsets inside replaced spans", () => {
    const ps = [{ start: 2, end: 4, text: "XYZ" }];
    expect(mapOffset(1, ps)).toBe(1);
    expect(mapOffset(5, ps)).toBe(6);
    expect(mapOffset(3, ps)).toBeNull();
    expect(mapOffset(2, [{ start: 2, end: 2, text: "ab" }])).toBe(4);
  });
});
