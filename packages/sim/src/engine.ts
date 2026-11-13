/**
 * Hosting vertep: which WebAssembly build a chart needs, and a small pool of `ActorSystem`s,
 * one per build, created lazily and kept for the lifetime of a validator or simulator.
 *
 * vertep runs charts on the `null` and CEL datamodels in its bundled builds; ECMAScript needs
 * the separate `@vertep/dm-ecma` build. A system loads exactly one build, so a document that
 * switches datamodel is served by a second system rather than a restarted one.
 */
// @tg: implements:: [[openspec:chart-validation#Datamodel-aware checks]]
// @tg: implements:: [[openspec:chart-simulation#Simulation runs on the vertep interpreter]]

import { type ActorSystem, type BuildRef, type SystemOptions, createActorSystem } from "@vertep/web";

/** The two chart surfaces; the same union as `Format` in `@vertepnyk/core`. */
export type Format = "scxml" | "yaml";

/** Which WebAssembly build hosts a chart. */
export type BuildKind = "default" | "ecmascript";

/** Options shared by the validator and the simulator: how to start vertep's worker. */
export interface EngineOptions {
  /**
   * The `@vertep/web` worker entry, for hosts that serve it as an asset (VS Code webviews,
   * Obsidian); the package's bundled `worker.js` by default.
   */
  workerUrl?: URL | string;
  /**
   * The ECMAScript build (glue and wasm URLs); `ecmascript` from `@vertep/dm-ecma` by default,
   * loaded only when a chart declares `datamodel="ecmascript"`.
   */
  ecmascriptBuild?: BuildRef | (() => Promise<BuildRef>);
  /** Further `createActorSystem` options passed through (not `storage`, `journal`, `datamodel`). */
  system?: Omit<Partial<SystemOptions>, "storage" | "journal" | "datamodel" | "workerUrl">;
  /** Replaces `createActorSystem`, for hosts that wrap it. */
  createSystem?: (options: SystemOptions) => Promise<ActorSystem>;
}

/**
 * The datamodel a chart declares, read from its text alone: the `datamodel` attribute of the
 * root `<scxml>` element, or the top-level `datamodel` key of a YAML chart. `null` when absent
 * (vertep's default applies).
 */
export function declaredDatamodel(text: string, format: Format): string | null {
  if (format === "scxml") {
    const root = stripXmlNoise(text).match(/<scxml\b[^>]*>/);
    const m = root?.[0].match(/\sdatamodel\s*=\s*(["'])(.*?)\1/);
    return m?.[2]?.trim() || null;
  }
  const m = text.match(/^datamodel[ \t]*:[ \t]*(["']?)([^"'#\s]*)\1/m);
  return m?.[2] || null;
}

/** The build a datamodel needs: ECMAScript has its own; `null`, CEL and the rest the default. */
export function buildFor(datamodel: string | null): BuildKind {
  return datamodel?.toLowerCase() === "ecmascript" ? "ecmascript" : "default";
}

/** Removes comments, CDATA and processing instructions, keeping offsets irrelevant. */
export function stripXmlNoise(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

async function ecmascriptBuild(options: EngineOptions): Promise<BuildRef> {
  const b = options.ecmascriptBuild;
  if (typeof b === "function") return b();
  if (b) return b;
  const m = await import("@vertep/dm-ecma");
  return m.ecmascript as BuildRef;
}

/** One lazily started `ActorSystem` per build, all with memory storage. */
export class SystemPool {
  readonly #options: EngineOptions;
  readonly #journal: boolean;
  readonly #systems = new Map<BuildKind, Promise<ActorSystem>>();
  #disposed = false;

  constructor(options: EngineOptions, journal: boolean) {
    this.#options = options;
    this.#journal = journal;
  }

  /** The system for `kind`, starting it on first use. */
  get(kind: BuildKind): Promise<ActorSystem> {
    if (this.#disposed) return Promise.reject(new Error("the engine is disposed"));
    let s = this.#systems.get(kind);
    if (!s) {
      s = this.#start(kind);
      this.#systems.set(kind, s);
      // a failed start is not cached: the next call tries again
      s.catch(() => {
        if (this.#systems.get(kind) === s) this.#systems.delete(kind);
      });
    }
    return s;
  }

  async #start(kind: BuildKind): Promise<ActorSystem> {
    const o = this.#options;
    const options: SystemOptions = {
      ...o.system,
      storage: "memory",
      journal: this.#journal,
      ...(o.workerUrl !== undefined ? { workerUrl: o.workerUrl } : {}),
      ...(kind === "ecmascript" ? { datamodel: await ecmascriptBuild(o) } : {}),
    };
    return (o.createSystem ?? createActorSystem)(options);
  }

  /** Stops the system of `kind` (the next `get` starts a fresh one). */
  async recycle(kind: BuildKind): Promise<void> {
    const s = this.#systems.get(kind);
    this.#systems.delete(kind);
    if (s) await s.then((x) => x.terminate()).catch(() => undefined);
  }

  /** Stops every system. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    const all = [...this.#systems.values()];
    this.#systems.clear();
    await Promise.all(all.map((s) => s.then((x) => x.terminate()).catch(() => undefined)));
  }
}
