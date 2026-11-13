import { describe, expect, it } from "vitest";
import { afterSaveReport, choiceOf, closeNeedsPrompt, outcomeOf } from "../src/closing.js";

describe("closing a window", () => {
  // @tg: verifies:: [[openspec:electron-app#External changes are picked up#Git checkout while open]] {level: unit}
  it("asks only when there are unsaved edits", () => {
    expect(closeNeedsPrompt({ dirty: false, forced: false })).toBe(false);
    expect(closeNeedsPrompt({ dirty: true, forced: false })).toBe(true);
    expect(closeNeedsPrompt({ dirty: true, forced: true })).toBe(false);
  });

  it("maps the buttons to outcomes", () => {
    expect(outcomeOf(choiceOf(0))).toBe("save-then-close");
    expect(outcomeOf(choiceOf(1))).toBe("close");
    expect(outcomeOf(choiceOf(2))).toBe("stay");
    expect(outcomeOf(choiceOf(-1))).toBe("stay");
  });

  it("closes after a save only when the document is clean again", () => {
    expect(afterSaveReport(false)).toBe("close");
    expect(afterSaveReport(true)).toBe("abandon");
  });
});
