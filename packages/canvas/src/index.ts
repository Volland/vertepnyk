/**
 * @vertepnyk/canvas — the SolidJS and SVG statechart canvas.
 */
export { Canvas } from "./Canvas.jsx";
export type { CanvasApi, CanvasProps, ContextMenuInfo, DiagnosticMap, Viewport } from "./Canvas.jsx";
export type { CanvasDiagnostic, Severity } from "./ctx.js";
export { copySelection, pasteSelection, parseClipboard, serializeClipboard, deleteImpact, deleteCommands } from "./clipboard.js";
export type { ClipboardPayload, ClipboardState, ClipboardTransition, DeleteInfo, PasteResult } from "./clipboard.js";
export { computeScene, computeEdges, smoothPath, stateAt } from "./geometry.js";
export type { EdgeInfo, Rect, Scene } from "./geometry.js";
export { generateChart } from "./bench.js";
export { themeVars } from "./styles.js";
