import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EngineAssets } from "../src/assets.js";
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
});
