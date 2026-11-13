/**
 * vertep's worker and WebAssembly builds and the layout worker, shipped inside the plugin
 * folder (`assets/`) and loaded without network access.
 *
 * Workers are started from Blob URLs: the plugin folder is served as `app://<hash>/...`, a
 * different origin from the app page, where a worker script (and a module it imports) may be
 * refused. Blob URLs are same-origin to the page and to the worker, so the worker bundle is
 * self-contained and its WebAssembly builds are handed to it as Blob URLs of their own.
 */
import { createLayoutWorker, type LayoutClient } from "@vertepnyk/layout";
import type { DesignerUiOptions } from "@vertepnyk/designer";

/** The slice of Obsidian's `DataAdapter` the plugin needs. */
export interface AssetAdapter {
  readBinary(path: string): Promise<ArrayBuffer>;
  getResourcePath(path: string): string;
}

interface BuildRef {
  glue: string;
  wasm: string;
  datamodels: string[];
  journal: boolean;
}

const MIME: Record<string, string> = { js: "text/javascript", wasm: "application/wasm" };

// @tg: implements:: [[openspec:host-bridge#WebAssembly loads in every host]]
export class EngineAssets {
  readonly #adapter: AssetAdapter;
  readonly #dir: string;
  readonly #urls = new Map<string, Promise<string>>();
  readonly #made = new Set<string>();

  /** `dir` is the plugin folder, e.g. `.obsidian/plugins/vertepnyk`. */
  constructor(adapter: AssetAdapter, dir: string) {
    this.#adapter = adapter;
    this.#dir = dir;
  }

  /** `assets/<rel>` inside the plugin folder. */
  path(rel: string): string {
    return `${this.#dir}/assets/${rel}`;
  }

  /** The `app://` resource URL of an asset (for display; workers use `url`). */
  resourceUrl(rel: string): string {
    return this.#adapter.getResourcePath(this.path(rel));
  }

  /** A Blob URL for the bytes of `assets/<rel>`, read once. */
  url(rel: string): Promise<string> {
    let u = this.#urls.get(rel);
    if (!u) {
      u = this.#adapter.readBinary(this.path(rel)).then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: MIME[rel.split(".").pop() ?? ""] ?? "application/octet-stream" }));
        this.#made.add(url);
        return url;
      });
      u.catch(() => this.#urls.delete(rel));
      this.#urls.set(rel, u);
    }
    return u;
  }

  /** Blob URLs of one WebAssembly build's glue module and binary. */
  async #build(dir: "core" | "journal" | "ecma", datamodels: string[], journal: boolean): Promise<BuildRef> {
    const [glue, wasm] = await Promise.all([this.url(`${dir}/vertep_wasm.js`), this.url(`${dir}/vertep_wasm_bg.wasm`)]);
    return { glue, wasm, datamodels, journal };
  }

  #engine: Promise<NonNullable<DesignerUiOptions["engine"]>> | undefined;

  /**
   * Engine options for `DesignerController`. vertep's worker is bundled self-contained at build
   * time with its two relative WebAssembly lookups replaced by `globalThis.__VERTEP_BUILDS`;
   * here a prelude defining that table (Blob URLs of the plugin's own builds) is put in front
   * of the bundle and the pair becomes the worker's Blob URL. Nothing is fetched remotely.
   */
  engine(): Promise<NonNullable<DesignerUiOptions["engine"]>> {
    this.#engine ??= (async () => {
      const [core, journal, ecma, worker] = await Promise.all([
        this.#build("core", [], false),
        this.#build("journal", [], true),
        this.#build("ecma", ["ecmascript"], true),
        this.#adapter.readBinary(this.path("vertep-worker.js")),
      ]);
      const prelude = `globalThis.__VERTEP_BUILDS=${JSON.stringify({ core, journal })};\n`;
      const workerUrl = URL.createObjectURL(new Blob([prelude, worker], { type: "text/javascript" }));
      this.#made.add(workerUrl);
      return { workerUrl, ecmascriptBuild: ecma };
    })();
    this.#engine.catch(() => (this.#engine = undefined));
    return this.#engine;
  }

  /**
   * A layout client in its own worker; in-process when the worker cannot be loaded, so a chart
   * is still laid out (briefly blocking the UI thread) rather than left unplaced.
   */
  async layoutClient(opts: { inProcess?: boolean } = {}): Promise<LayoutClient> {
    if (opts.inProcess || typeof Worker === "undefined") return createLayoutWorker(undefined, { inProcess: true });
    try {
      const url = await this.url("layout-worker.js");
      return createLayoutWorker(url);
    } catch (e) {
      console.warn("vertepnyk: the layout worker could not be loaded; laying out in-process", e);
      return createLayoutWorker(undefined, { inProcess: true });
    }
  }

  /** Revokes every Blob URL made. */
  dispose(): void {
    for (const u of this.#made) URL.revokeObjectURL(u);
    this.#made.clear();
    this.#urls.clear();
    this.#engine = undefined;
  }
}
