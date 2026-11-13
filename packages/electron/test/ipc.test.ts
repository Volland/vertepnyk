import { describe, expect, it } from "vitest";
import { FILES_API_KEYS, MAX_TEXT, checkConfirm, checkDirty, checkPath, checkSave, checkSaveAs, isTrustedSenderUrl } from "../src/ipc.js";
import { PathGrants } from "../src/grants.js";
import { SelfWrites } from "../src/selfWrites.js";
import { resolveAppPath, mimeOf } from "../src/assets.js";
import { CSP } from "../src/csp.js";

describe("IPC validation", () => {
  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: unit}
  it("trusts only frames of the app's own origin", () => {
    expect(isTrustedSenderUrl("app://vertepnyk/index.html")).toBe(true);
    for (const bad of ["https://example.com/", "app://evil/index.html", "app://vertepnyk.evil.com/", "file:///x.html", "", undefined, 3]) {
      expect(isTrustedSenderUrl(bad)).toBe(false);
    }
  });

  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: unit}
  it("accepts only document paths and bounded text for save", () => {
    expect(checkSave(["/a/x.scxml", "<scxml/>"])).toEqual({ ok: true, value: { path: "/a/x.scxml", text: "<scxml/>" } });
    expect(checkSave(["/a/x.sh", "x"]).ok).toBe(false);
    expect(checkSave(["x.scxml", "x"]).ok).toBe(false);
    expect(checkSave(["/a/x.scxml", 5]).ok).toBe(false);
    expect(checkSave(["/a/x.scxml"]).ok).toBe(false);
    expect(checkSave(["/a/x.scxml", "x", "extra"]).ok).toBe(false);
    expect(checkSave(["/a/x.scxml", "x".repeat(MAX_TEXT + 1)]).ok).toBe(false);
  });

  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: unit}
  it("accepts only bare names for save-as and one path for open and watch", () => {
    expect(checkSaveAs(["a.vt.yaml", "x"]).ok).toBe(true);
    expect(checkSaveAs(["../a.vt.yaml", "x"]).ok).toBe(false);
    expect(checkSaveAs(["a.txt", "x"]).ok).toBe(false);
    expect(checkPath(["/a/b.vt.yml"]).ok).toBe(true);
    expect(checkPath(["/a/b.json"]).ok).toBe(false);
    expect(checkPath([]).ok).toBe(false);
    expect(checkPath([{ toString: () => "/a/b.scxml" }]).ok).toBe(false);
  });

  it("validates the dirty flag and confirm options", () => {
    expect(checkDirty([true]).ok).toBe(true);
    expect(checkDirty(["true"]).ok).toBe(false);
    expect(checkConfirm([{ message: "Reload?", ok: "Reload", cancel: "Keep" }])).toEqual({ ok: true, value: { message: "Reload?", detail: "", ok: "Reload", cancel: "Keep" } });
    expect(checkConfirm([{ message: "" }]).ok).toBe(false);
    expect(checkConfirm([{ message: "x".repeat(400) }]).ok).toBe(false);
    expect(checkConfirm(["x"]).ok).toBe(false);
    expect(checkConfirm([null]).ok).toBe(false);
  });

  it("lists the preload API's keys", () => {
    expect([...FILES_API_KEYS].sort()).toEqual(["confirm", "onCommand", "onFileChanged", "onOpenRequest", "open", "openPath", "recent", "save", "saveAs", "setDirty", "unwatch", "watch"]);
  });

  it("grants only the paths it was given", () => {
    const g = new PathGrants();
    g.grant("/a/b/../x.scxml");
    expect(g.has("/a/x.scxml")).toBe(true);
    expect(g.has("/a/y.scxml")).toBe(false);
  });

  it("tells its own writes from external changes", () => {
    const w = new SelfWrites();
    w.record("/a/x.scxml", "one");
    expect(w.isOwn("/a/x.scxml", "one")).toBe(true);
    expect(w.isOwn("/a/x.scxml", "two")).toBe(false);
    expect(w.isOwn("/a/y.scxml", "one")).toBe(false);
  });
});

describe("renderer assets", () => {
  it("serves from the root and never outside it", () => {
    expect(resolveAppPath("/r", "/")).toBe("/r/index.html");
    expect(resolveAppPath("/r", "/assets/a.js")).toBe("/r/assets/a.js");
    expect(resolveAppPath("/r", "/../secret")).toBeNull();
    expect(resolveAppPath("/r", "/%2e%2e/secret")).toBeNull();
    expect(resolveAppPath("/r", "/a/%00.js")).toBeNull();
    expect(resolveAppPath("/r", "/%E0%A4%A")).toBeNull();
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: unit}
  it("serves WebAssembly with its MIME type and a CSP that allows it and nothing remote", () => {
    expect(mimeOf("vertep_wasm_bg.wasm")).toBe("application/wasm");
    expect(mimeOf("a.js")).toContain("text/javascript");
    expect(CSP).toContain("'wasm-unsafe-eval'");
    expect(CSP).not.toMatch(/https?:|\*/);
  });
});
