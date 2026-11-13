import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { EngineAssets } from "../src/assets.js";
import { EmbeddedAssetAdapter, withEmbeddedAssets } from "../src/embedded.js";
import { MANIFEST, loadPlugin } from "./helpers.js";

const pkg = [resolve(process.cwd(), "packages/obsidian"), process.cwd()].find((d) => { try { readFileSync(join(d, "static/manifest.json")); return true; } catch { return false; } })!;
const json = (f: string) => JSON.parse(readFileSync(join(pkg, f), "utf8"));

describe("distribution", () => {
  // @tg: verifies:: [[openspec:obsidian-plugin#Obsidian distribution#Desktop only declared]] {level: unit}
  it("declares the plugin desktop-only", () => {
    const m = json("static/manifest.json");
    expect(m.isDesktopOnly).toBe(true);
    expect(m.id).toBe("vertepnyk");
    expect(m.name).toBe("Vertepnyk");
    expect(m.id).toBe(MANIFEST.id);
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Obsidian distribution#Desktop only declared]] {level: unit}
  it("has a versions file that maps the manifest version to its minimum app version", () => {
    const m = json("static/manifest.json");
    const v = json("static/versions.json");
    expect(v[m.version]).toBe(m.minAppVersion);
    expect(json("package.json").version).toBe(m.version);
  });
});

describe("engine assets", () => {
  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: unit}
  it("reads vertep's worker and WebAssembly builds from the plugin folder, never the network", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetch);
    const read: string[] = [];
    const adapter = {
      readBinary: async (p: string) => {
        read.push(p);
        return new TextEncoder().encode(`bytes of ${p}`).buffer as ArrayBuffer;
      },
      getResourcePath: (p: string) => `app://x/${p}`,
    };
    const blobs: Blob[] = [];
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => (blobs.push(b as Blob), `blob:mock/${blobs.length}`));
    const assets = new EngineAssets(adapter, ".obsidian/plugins/vertepnyk");
    const engine = await assets.engine();
    expect(engine.workerUrl).toMatch(/^blob:/);
    expect(engine.ecmascriptBuild).toMatchObject({ datamodels: ["ecmascript"], journal: true });
    expect(read.every((p) => p.startsWith(".obsidian/plugins/vertepnyk/assets/"))).toBe(true);
    expect(read).toContain(".obsidian/plugins/vertepnyk/assets/vertep-worker.js");
    expect(read).toContain(".obsidian/plugins/vertepnyk/assets/core/vertep_wasm_bg.wasm");
    // the worker blob starts with the table of the WebAssembly builds, then the bundle
    const worker = blobs.at(-1)!;
    const text = await worker.text();
    expect(text.startsWith("globalThis.__VERTEP_BUILDS=")).toBe(true);
    expect(text).toContain('"core":{"glue":"blob:mock/');
    expect(text).toContain("bytes of .obsidian/plugins/vertepnyk/assets/vertep-worker.js");
    // cached: a second call reads nothing
    const n = read.length;
    await assets.engine();
    expect(read.length).toBe(n);
    expect(fetch).not.toHaveBeenCalled();
    assets.dispose();
    create.mockRestore();
    vi.unstubAllGlobals();
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: unit}
  it("lays out in-process when the layout worker cannot be loaded", async () => {
    const { app, plugin } = await loadPlugin();
    expect(app.vault.binaries.size).toBe(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Worker", class {});
    const client = await new EngineAssets({ readBinary: () => Promise.reject(new Error("ENOENT")), getResourcePath: (p) => p }, "x").layoutClient();
    expect(client.offThread).toBe(false);
    expect(warn).toHaveBeenCalled();
    vi.unstubAllGlobals();
    warn.mockRestore();
    expect(plugin).toBeDefined();
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: unit}
  it("serves assets compiled into main.js, and reads anything else from the plugin folder", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("network")));
    vi.stubGlobal("fetch", fetch);
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 42]);
    const table = { "core/vertep_wasm_bg.wasm": gzipSync(wasm).toString("base64") };
    const fromFolder: string[] = [];
    const folder = {
      readBinary: async (p: string) => (fromFolder.push(p), new TextEncoder().encode(`file ${p}`).buffer as ArrayBuffer),
      getResourcePath: (p: string) => `app://x/${p}`,
    };
    const adapter = new EmbeddedAssetAdapter(table, folder);
    const got = new Uint8Array(await adapter.readBinary(".obsidian/plugins/vertepnyk/assets/core/vertep_wasm_bg.wasm"));
    expect([...got]).toEqual([...wasm]);
    // each read is a fresh copy, so a transferred buffer never empties the cache
    const again = await adapter.readBinary(".obsidian/plugins/vertepnyk/assets/core/vertep_wasm_bg.wasm");
    expect(again.byteLength).toBe(wasm.length);
    expect(fromFolder).toEqual([]);
    await adapter.readBinary(".obsidian/plugins/vertepnyk/assets/vertep-worker.js");
    expect(fromFolder).toEqual([".obsidian/plugins/vertepnyk/assets/vertep-worker.js"]);
    expect(adapter.getResourcePath("x")).toBe("app://x/x");
    // without a compiled table the vault adapter is used as it is
    expect(withEmbeddedAssets(folder, undefined)).toBe(folder);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

