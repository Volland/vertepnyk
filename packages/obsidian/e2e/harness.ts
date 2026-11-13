/**
 * Browser side of the e2e harness: loads the BUILT dist/main.js as Obsidian would (CJS with
 * `require("obsidian")`), against the mock `obsidian` module, and serves its assets over HTTP.
 */
import * as mock from "../test/mock-obsidian";

declare global {
  interface Window {
    __harness: { boot(mainJs: string): Promise<{ app: mock.App; plugin: any }> };
  }
}

window.__harness = {
  async boot(mainJs) {
    const app = new mock.App();
    const module = { exports: {} as { default?: new (a: unknown, m: unknown) => any } };
    new Function("module", "exports", "require", mainJs)(module, module.exports, (name: string) => {
      if (name === "obsidian") return mock;
      throw new Error(`unexpected require("${name}")`);
    });
    const dir = ".obsidian/plugins/vertepnyk";
    // the plugin folder is served at /plugin/
    app.vault.adapter.readBinary = async (p: string) => {
      const r = await fetch(`/plugin/${p.slice(dir.length + 1)}`);
      if (!r.ok) throw new Error(`${r.status} ${p}`);
      return r.arrayBuffer();
    };
    const plugin = new module.exports.default!(app, { id: "vertepnyk", name: "Vertepnyk", version: "0.1.0", dir });
    await plugin.onload();
    return { app, plugin };
  },
};
