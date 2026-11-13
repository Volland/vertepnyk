import { describe, expect, it } from "vitest";
import { parseYamlDocument, printYamlCst } from "../src/yaml/cst.js";
import { ChartParseFailure } from "../src/errors.js";
import { fixture, fixtureNames } from "./helpers.js";

describe("YAML layer", () => {
  it("round-trips every YAML fixture byte for byte through the CST", () => {
    for (const f of fixtureNames(".vt.yaml")) {
      const t = fixture(f);
      expect(printYamlCst(t), f).toBe(t);
      expect(parseYamlDocument(t).errors).toEqual([]);
    }
  });

  it("round-trips generated documents with comments, flow and block styles (property)", () => {
    let seed = 11;
    const rnd = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const scalar = () => ["a", '"q x"', "'s'", "12", "null", "~", "x.y"][rnd(7)]!;
    const gen = (ind: string, depth: number): string => {
      let out = "";
      for (let k = rnd(3) + 1; k > 0; k--) {
        const c = rnd(4) === 0 ? `  # c${k}` : "";
        if (depth === 0 || rnd(3) === 0) out += `${ind}k${k}: ${scalar()}${c}\n`;
        else if (rnd(2)) out += `${ind}k${k}: { a: ${scalar()}, b: [${scalar()}, ${scalar()}] }${c}\n`;
        else if (rnd(2)) out += `${ind}k${k}:${c}\n${ind}  - ${scalar()}\n${ind}  - x: ${scalar()}\n`;
        else out += `${ind}k${k}:${c}\n${gen(ind + "  ", depth - 1)}`;
        if (rnd(5) === 0) out += "\n";
      }
      return out;
    };
    for (let n = 0; n < 200; n++) {
      const t = `${rnd(2) ? "# head\n" : ""}${gen("", 3)}${rnd(2) ? "" : "# tail"}`;
      expect(printYamlCst(t)).toBe(t);
    }
  });

  it("reports syntax errors with offset, line and column", () => {
    const t = "a: 1\nb: [1, 2\nc: 3\n";
    try {
      parseYamlDocument(t);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChartParseFailure);
      const info = (e as ChartParseFailure).info;
      expect(info.line).toBeGreaterThanOrEqual(2);
      expect(info.offset).toBeGreaterThan(0);
      expect(info.column).toBeGreaterThan(0);
    }
    expect(() => parseYamlDocument("a: 1\na: 2\n")).toThrow(ChartParseFailure);
  });
});
