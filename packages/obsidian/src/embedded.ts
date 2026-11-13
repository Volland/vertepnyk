/**
 * Assets compiled into `main.js`, so the plugin installs from Obsidian's community directory,
 * which downloads only `main.js`, `manifest.json` and `styles.css`.
 *
 * The build gzips every file of `assets/` (vertep's worker and WebAssembly builds, the layout
 * worker) and puts them, base64-encoded, into the table `__VERTEPNYK_EMBEDDED__`. Reads of
 * `<plugin dir>/assets/<rel>` are served from that table; anything not in it falls through to
 * the vault adapter, so a plugin folder with a separate `assets/` still works.
 */
import type { AssetAdapter } from "./assets.js";

/** `assets/<rel>` relative path to its gzipped bytes in base64. */
export type EmbeddedTable = Record<string, string>;

declare const __VERTEPNYK_EMBEDDED__: EmbeddedTable | undefined;

/** The table the build compiled in, if any (none in tests and development builds). */
export function compiledTable(): EmbeddedTable | undefined {
  return typeof __VERTEPNYK_EMBEDDED__ === "undefined" ? undefined : __VERTEPNYK_EMBEDDED__;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** Serves `…/assets/<rel>` from `table`, decompressing each file once; other reads go to `fallback`. */
// @tg: implements:: [[openspec:obsidian-plugin#Obsidian distribution]] {note: "installs as main.js, manifest.json and styles.css alone"}
export class EmbeddedAssetAdapter implements AssetAdapter {
  readonly #table: EmbeddedTable;
  readonly #fallback: AssetAdapter;
  readonly #cache = new Map<string, Promise<ArrayBuffer>>();

  constructor(table: EmbeddedTable, fallback: AssetAdapter) {
    this.#table = table;
    this.#fallback = fallback;
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const i = path.lastIndexOf("/assets/");
    const rel = i >= 0 ? path.slice(i + "/assets/".length) : undefined;
    const b64 = rel === undefined ? undefined : this.#table[rel];
    if (rel === undefined || b64 === undefined) return this.#fallback.readBinary(path);
    let p = this.#cache.get(rel);
    if (!p) {
      p = gunzip(fromBase64(b64));
      this.#cache.set(rel, p);
    }
    // a copy each time: the caller may transfer or detach the buffer
    return p.then((b) => b.slice(0));
  }

  getResourcePath(path: string): string {
    return this.#fallback.getResourcePath(path);
  }
}

/** `adapter`, with the compiled-in assets in front of it when the build has any. */
export function withEmbeddedAssets(adapter: AssetAdapter, table = compiledTable()): AssetAdapter {
  return table ? new EmbeddedAssetAdapter(table, adapter) : adapter;
}
