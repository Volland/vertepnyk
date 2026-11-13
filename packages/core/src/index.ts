/**
 * @vertepnyk/core — the format-preserving chart document model.
 *
 * Contract (implemented in ./document.ts and friends):
 *
 *   class ChartDocument {
 *     static open(text: string, format: Format): ChartDocument;
 *     readonly text: string; readonly format: Format;
 *     readonly model: ChartModel | null;   // last good parse
 *     readonly error: ParseError | null;   // current parse error, if any
 *     setText(text: string, origin?: ChangeOrigin): void;  // external change: re-parse
 *     apply(cmd: Command | readonly Command[], opts?: { mergeKey?: string }): readonly TextPatch[];
 *         // throws EditError (text unchanged) or EditError("ParseError") while the text does not parse
 *     undo(): boolean; redo(): boolean; readonly canUndo: boolean; readonly canRedo: boolean;
 *     onChange(listener: (c: DocumentChange) => void): () => void;
 *     positionAt(offset: number): Position;
 *   }
 *   function newChart(format: Format, name?: string): string;
 *   function detectFormat(fileName: string): Format | null;   // *.scxml, *.vt.yaml / *.vt.yml
 *   function applyPatches(text: string, patches: readonly TextPatch[]): string;
 *   function uniqueId(model: ChartModel, base: string): string;
 */
export * from "./model.js";
