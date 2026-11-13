import { detectFormat, type Format } from "@vertepnyk/core";
import { normalizePath, type App } from "obsidian";

export const VIEW_TYPE = "vertepnyk-designer";

/** The format of a chart file name (`*.scxml`, `*.vt.yaml`, `*.vt.yml`), or null. */
export function chartFormat(fileName: string): Format | null {
  return detectFormat(fileName);
}

export const isChartFileName = (fileName: string): boolean => chartFormat(fileName) !== null;

/** The file name of a link or embed target without `#heading` and `|alias`. */
export function linkFileName(src: string): string {
  return src.split("|")[0]!.split("#")[0]!.trim();
}

/** Writes `contents` as `suggestedName` in the same folder as `path` (the exported SVG). */
export async function writeBeside(app: App, path: string, suggestedName: string, contents: string): Promise<string> {
  const slash = path.lastIndexOf("/");
  const target = normalizePath(slash >= 0 ? `${path.slice(0, slash)}/${suggestedName}` : suggestedName);
  await app.vault.adapter.write(target, contents);
  return target;
}
