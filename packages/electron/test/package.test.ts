import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP } from "../src/csp.js";

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  build: { appId: string; fileAssociations: { ext: string }[]; mac: { target: { target: string; arch: string[] }[]; hardenedRuntime: boolean }; win: { target: { target: string }[] }; linux: { target: string[] } };
};
const workflow = readFileSync(resolve(root, "../../.github/workflows/release-electron.yml"), "utf8");

describe("distribution", () => {
  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("registers the app as an opener for .scxml and YAML documents", () => {
    expect(pkg.build.fileAssociations.map((a) => a.ext)).toEqual(expect.arrayContaining(["scxml", "yaml"]));
  });

  // @tg: verifies:: [[openspec:electron-app#Desktop distribution#Release artifacts]] {level: unit}
  it("builds macOS (universal), Windows and Linux", () => {
    expect(pkg.build.appId).toBe("io.github.volland.vertepnyk");
    expect(pkg.build.mac.target.map((t) => t.target)).toEqual(["dmg", "zip"]);
    expect(pkg.build.mac.target.every((t) => t.arch.includes("universal"))).toBe(true);
    expect(pkg.build.win.target.map((t) => t.target)).toContain("nsis");
    expect(pkg.build.linux.target).toEqual(["AppImage", "deb"]);
  });

  // @tg: verifies:: [[openspec:electron-app#Desktop distribution#Release artifacts]] {level: unit}
  it("has a release workflow on version tags that builds three platforms and attaches them to the release", () => {
    expect(workflow).toMatch(/tags:\s*\n\s*-\s*["']?v\*/);
    for (const os of ["macos-latest", "windows-latest", "ubuntu-latest"]) expect(workflow).toContain(os);
    expect(workflow).toContain("--publish never");
    expect(workflow).toContain("softprops/action-gh-release");
  });
});

describe("renderer page", () => {
  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: unit}
  it("carries the same CSP as the protocol handler sends", () => {
    const html = readFileSync(resolve(root, "renderer/index.html"), "utf8");
    expect(html).toContain(`content="${CSP}"`);
  });

  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: unit}
  it("creates windows with context isolation, no Node integration, the sandbox and web security", () => {
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
    for (const s of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true"]) expect(main).toContain(s);
    expect(main).not.toMatch(/webSecurity:\s*false|nodeIntegration:\s*true|sandbox:\s*false|contextIsolation:\s*false/);
  });
});
