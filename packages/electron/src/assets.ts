/** Serving the renderer from `app://vertepnyk/`: path resolution that cannot leave the root, and MIME types. */
import { extname, resolve, sep } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "vertepnyk";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export const mimeOf = (file: string): string => MIME[extname(file).toLowerCase()] ?? "application/octet-stream";

/** The file under `root` for a request path, or null when it would leave `root`. */
export function resolveAppPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = decoded === "/" || decoded === "" ? "/index.html" : decoded;
  const abs = resolve(root, `.${rel}`);
  const base = resolve(root);
  return abs === base || !abs.startsWith(base + sep) ? null : abs;
}
