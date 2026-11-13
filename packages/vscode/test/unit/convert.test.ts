import { describe, expect, it } from "vitest";
import { applyPatches, type TextPatch } from "@vertepnyk/core";
import { checkRev, patchesToEdits, revealRange, toDiagnostics, type DocLike } from "../../src/convert.js";

/** A `TextDocument` stand-in over a string. */
function doc(text: string, version = 1): DocLike {
  const lines = text.split("\n");
  return {
    version,
    lineCount: lines.length,
    textLength: () => text.length,
    lineLength: (l) => lines[l]?.length ?? 0,
    positionAt(o) {
      let line = 0;
      let left = o;
      while (line < lines.length - 1 && left > lines[line]!.length) {
        left -= lines[line]!.length + 1;
        line++;
      }
      return { line, character: left };
    },
  };
}

/** Applies edits the way VS Code applies a `WorkspaceEdit`: all against the original text. */
function applyEdits(text: string, d: DocLike, edits: ReturnType<typeof patchesToEdits>): string {
  const off = (p: { line: number; character: number }): number => {
    let o = 0;
    const ls = text.split("\n");
    for (let i = 0; i < p.line; i++) o += ls[i]!.length + 1;
    return o + p.character;
  };
  return [...edits].sort((a, b) => off(b.range.start) - off(a.range.start)).reduce((t, e) => t.slice(0, off(e.range.start)) + e.newText + t.slice(off(e.range.end)), text);
}

describe("patch to edit conversion", () => {
  const text = '<scxml>\n  <state id="a"/>\n  <state id="b"/>\n</scxml>';

  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: unit}
  it("turns offsets into line and character positions across lines", () => {
    const patches: TextPatch[] = [{ start: text.indexOf('"b"') + 1, end: text.indexOf('"b"') + 2, text: "bee" }];
    const d = doc(text);
    const [e] = patchesToEdits(d, patches);
    expect(e).toEqual({ range: { start: { line: 2, character: 13 }, end: { line: 2, character: 14 } }, newText: "bee" });
  });

  // @tg: verifies:: [[openspec:vscode-extension#Native undo and save#Undo through VS Code]] {level: unit}
  it("yields edits that reproduce the designer's own patched text", () => {
    const patches: TextPatch[] = [
      { start: 8, end: 8, text: '  <state id="new"/>\n' },
      { start: text.indexOf('"a"') + 1, end: text.indexOf('"a"') + 2, text: "alpha" },
      { start: text.length - 8, end: text.length - 8, text: "" },
    ];
    const d = doc(text);
    expect(applyEdits(text, d, patchesToEdits(d, patches))).toBe(applyPatches(text, patches));
  });

  it("rejects a patch outside the document instead of corrupting it", () => {
    expect(() => patchesToEdits(doc("abc"), [{ start: 2, end: 9, text: "" }])).toThrow(RangeError);
    expect(() => patchesToEdits(doc("abc"), [{ start: 2, end: 1, text: "" }])).toThrow(RangeError);
  });
});

describe("revision conflict handling", () => {
  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: unit}
  it("accepts patches computed against the current document version", () => {
    expect(checkRev(7, 7)).toEqual({ ok: true });
  });

  // @tg: verifies:: [[openspec:vscode-extension#Text and visual toggle#Side by side]] {level: unit}
  it("refuses patches computed against an older version (the text changed meanwhile)", () => {
    expect(checkRev(6, 7)).toEqual({ ok: false, reason: "stale", current: 7 });
  });
});

describe("diagnostics conversion", () => {
  const text = '<scxml>\n  <state id="a">\n    <transition target="nowhere"/>\n  </state>\n</scxml>';
  const d = doc(text);

  // @tg: verifies:: [[openspec:vscode-extension#Problems panel#Violation in Problems]] {level: unit}
  it("places a violation at its 1-based line and column, to the end of the line", () => {
    const [x] = toDiagnostics(d, [{ message: "unknown target nowhere", severity: "error", line: 3, column: 5, source: "vertep", code: "unknown-target" }]);
    expect(x).toEqual({
      message: "unknown target nowhere",
      severity: "error",
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 34 } },
      source: "vertep",
      code: "unknown-target",
    });
  });

  // @tg: verifies:: [[openspec:vscode-extension#Problems panel#Violation in Problems]] {level: unit}
  it("prefers a text span over a line", () => {
    const start = text.indexOf("nowhere");
    const [x] = toDiagnostics(d, [{ message: "m", severity: "warning", span: { start, end: start + 7 }, line: 1, source: "vertep" }]);
    expect(x!.range).toEqual({ start: { line: 2, character: 24 }, end: { line: 2, character: 31 } });
  });

  it("clamps locations outside the file and defaults to the first line", () => {
    const [a, b] = toDiagnostics(d, [
      { message: "far", severity: "info", line: 99, column: 99, source: "parse" },
      { message: "none", severity: "error", source: "parse" },
    ]);
    expect(a!.range.start.line).toBe(4);
    expect(a!.range.start.character).toBe(8);
    expect(a!.source).toBe("vertepnyk");
    expect(b!.range.start).toEqual({ line: 0, character: 0 });
  });

  // @tg: verifies:: [[openspec:vscode-extension#Problems panel#Violation in Problems]] {level: unit}
  it("reveals a span or a line and column as a range in the text editor", () => {
    expect(revealRange(d, { span: { start: 8, end: 13 } })).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 5 } });
    expect(revealRange(d, { line: 3, column: 5 })).toEqual({ start: { line: 2, character: 4 }, end: { line: 2, character: 4 } });
  });
});
