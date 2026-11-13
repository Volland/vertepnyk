import type { ParseError } from "./model.js";
import { positionAt } from "./text.js";

/** Thrown by the format parsers; carries a `ParseError` with its position. */
export class ChartParseFailure extends Error {
  readonly info: ParseError;
  constructor(text: string, offset: number, message: string) {
    const pos = positionAt(text, offset);
    super(`${message} (line ${pos.line}, column ${pos.column})`);
    this.name = "ChartParseFailure";
    this.info = { message, offset, line: pos.line, column: pos.column };
  }
}
