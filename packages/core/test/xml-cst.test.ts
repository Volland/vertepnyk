import { describe, expect, it } from "vitest";
import { parseXml, printXml } from "../src/xml/cst.js";
import { ChartParseFailure } from "../src/errors.js";
import { fixture, fixtureNames, read, suiteFiles } from "./helpers.js";

describe("XML CST", () => {
  it("round-trips every SCXML fixture byte for byte", () => {
    for (const f of fixtureNames(".scxml")) {
      const t = fixture(f);
      expect(printXml(parseXml(t)), f).toBe(t);
    }
  });

  const suite = suiteFiles(".txml", ".scxml");
  it.skipIf(suite.length === 0)("round-trips every W3C suite document (txml and generated scxml)", () => {
    expect(suite.filter((f) => f.endsWith(".txml")).length).toBe(237);
    for (const f of suite) {
      const t = read(f);
      expect(printXml(parseXml(t)), f).toBe(t);
    }
  });

  it("keeps exact offsets of attribute names, values and quotes", () => {
    const t = `<a x = 'v&amp;w'  y="2"/>`;
    const d = parseXml(t);
    const [x, y] = d.root.attrs;
    expect(t.slice(x!.start, x!.nameEnd)).toBe("x");
    expect(x!.quote).toBe("'");
    expect(t.slice(x!.valueStart, x!.valueEnd)).toBe("v&amp;w");
    expect(x!.value).toBe("v&w");
    expect(y!.before).toBe("  ");
    expect(t.slice(y!.start, y!.end)).toBe('y="2"');
  });

  it("parses comments, CDATA, PIs, doctype and namespaces", () => {
    const t = `<?xml version="1.0"?>\n<!DOCTYPE s [ <!ENTITY e "x"> ]>\n<s xmlns="urn:a" xmlns:b="urn:b"><!-- c --><![CDATA[<x>]]><b:c b:d="1">&e;</b:c><?pi x?></s>\n`;
    const d = parseXml(t);
    expect(printXml(d)).toBe(t);
    expect(d.root.ns).toBe("urn:a");
    const kinds = d.root.children.map((c) => c.kind);
    expect(kinds).toEqual(["comment", "cdata", "element", "pi"]);
    const c = d.root.children[2];
    expect(c?.kind === "element" && c.ns).toBe("urn:b");
    expect(c?.kind === "element" && c.attrs[0]?.ns).toBe("urn:b");
  });

  it("round-trips random generated documents (property)", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const ws = () => [" ", "  ", "\n  ", "\t", "\n"][rnd(5)]!;
    const gen = (depth: number): string => {
      const name = ["state", "x:y", "transition", "a"][rnd(4)]!;
      let attrs = "";
      for (let k = rnd(3); k > 0; k--) attrs += `${ws()}at${k}${rnd(2) ? "=" : " = "}${rnd(2) ? `"v${k} &lt;"` : `'q${k}'`}`;
      const decl = name.startsWith("x:") ? ' xmlns:x="urn:x"' : "";
      if (depth === 0 || rnd(3) === 0) return `<${name}${decl}${attrs}${rnd(2) ? " " : ""}/>`;
      let kids = "";
      for (let k = rnd(4); k > 0; k--) {
        const r = rnd(4);
        kids += r === 0 ? `${ws()}<!-- c${k} -->` : r === 1 ? `text &amp; ${k}` : r === 2 ? "<![CDATA[ <> ]]>" : ws() + gen(depth - 1);
      }
      return `<${name}${decl}${attrs}>${kids}</${name}${rnd(2) ? " " : ""}>`;
    };
    for (let n = 0; n < 300; n++) {
      const t = `${rnd(2) ? '<?xml version="1.0"?>\n' : ""}${gen(4)}${rnd(2) ? "\n" : ""}`;
      expect(printXml(parseXml(t))).toBe(t);
    }
  });

  it("reports errors with offset, line and column", () => {
    const t = `<a>\n  <b>\n</a>`;
    try {
      parseXml(t);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChartParseFailure);
      const info = (e as ChartParseFailure).info;
      expect(info.line).toBe(3);
      expect(info.column).toBe(1);
      expect(info.offset).toBe(t.indexOf("</a>"));
    }
    expect(() => parseXml(`<a x=1/>`)).toThrow(ChartParseFailure);
    expect(() => parseXml(`<a>&bogus;</a>`)).toThrow(/unknown entity/);
    expect(() => parseXml(`<a/><b/>`)).toThrow(/one root/);
    expect(() => parseXml(`<a>`)).toThrow(/not closed/);
  });
});
