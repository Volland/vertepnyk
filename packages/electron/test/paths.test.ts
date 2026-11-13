import { describe, expect, it } from "vitest";
import { documentFormat, isDocumentName, isDocumentPath, pathsFromArgv, titleOf, withDocumentExtension } from "../src/paths.js";

describe("document paths", () => {
  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("accepts .scxml, .vt.yaml and .vt.yml, and nothing else", () => {
    expect(documentFormat("order.scxml")).toBe("scxml");
    expect(documentFormat("ORDER.SCXML")).toBe("scxml");
    expect(documentFormat("order.vt.yaml")).toBe("yaml");
    expect(documentFormat("order.vt.yml")).toBe("yaml");
    for (const bad of ["order.yaml", "order.txt", "order", "order.scxml.bak", "vt.yaml"]) expect(documentFormat(bad)).toBeNull();
  });

  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("accepts only absolute document paths", () => {
    expect(isDocumentPath("/tmp/order.scxml")).toBe(true);
    for (const bad of ["order.scxml", "../order.scxml", "/etc/passwd", "/tmp/a\0.scxml", "", 5, null, undefined, "/tmp/" + "x".repeat(5000) + ".scxml"]) {
      expect(isDocumentPath(bad)).toBe(false);
    }
  });

  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("accepts bare document names for the save dialog", () => {
    expect(isDocumentName("a.scxml")).toBe(true);
    expect(isDocumentName("dir/a.scxml")).toBe(false);
    expect(isDocumentName("..\\a.scxml")).toBe(false);
    expect(isDocumentName("a.txt")).toBe(false);
  });

  it("adds the suggested extension to a name typed without one", () => {
    expect(withDocumentExtension("/x/order", "a.scxml")).toBe("/x/order.scxml");
    expect(withDocumentExtension("/x/order.yaml", "a.vt.yaml")).toBe("/x/order.vt.yaml");
    expect(withDocumentExtension("/x/order.vt.yml", "a.scxml")).toBe("/x/order.vt.yml");
  });

  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("finds documents among command-line arguments", () => {
    const argv = ["/App/electron", ".", "--user-data-dir=/x/a.scxml", "/tmp/a.scxml", "rel/b.vt.yaml", "/tmp/c.txt", "/tmp/a.scxml"];
    expect(pathsFromArgv(argv, { cwd: "/work", defaultApp: true })).toEqual(["/tmp/a.scxml", "/work/rel/b.vt.yaml"]);
    // packaged: the first argument after the executable is already a document
    expect(pathsFromArgv(["/App/Vertepnyk", "/tmp/a.scxml"], { cwd: "/work", defaultApp: false })).toEqual(["/tmp/a.scxml"]);
    expect(pathsFromArgv(["/App/Vertepnyk"], { cwd: "/work", defaultApp: false })).toEqual([]);
  });

  it("titles a window with the file name and a dot when dirty", () => {
    expect(titleOf("/x/order.scxml", false)).toBe("order.scxml - Vertepnyk");
    expect(titleOf("/x/order.scxml", true)).toBe("order.scxml ● - Vertepnyk");
    expect(titleOf(null, false)).toBe("untitled - Vertepnyk");
  });
});
