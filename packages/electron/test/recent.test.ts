import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECENT_MAX, RecentFiles } from "../src/recent.js";

const tmp = (): string => join(mkdtempSync(join(tmpdir(), "vt-recent-")), "sub", "recent.json");

describe("recent files", () => {
  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("lists newest first and deduplicates", () => {
    const r = new RecentFiles(tmp());
    r.add("/a/one.scxml");
    r.add("/a/two.scxml");
    r.add("/a/one.scxml");
    expect(r.list()).toEqual(["/a/one.scxml", "/a/two.scxml"]);
  });

  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("keeps at most ten", () => {
    const r = new RecentFiles(tmp());
    for (let i = 0; i < 15; i++) r.add(`/a/f${i}.scxml`);
    expect(r.list()).toHaveLength(RECENT_MAX);
    expect(r.list()[0]).toBe("/a/f14.scxml");
    expect(r.list()).not.toContain("/a/f4.scxml");
  });

  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: unit}
  it("persists across instances and ignores what is not a document path", () => {
    const file = tmp();
    const r = new RecentFiles(file);
    r.add("/a/one.scxml");
    r.add("/a/ignored.txt");
    r.add("relative.scxml");
    expect(new RecentFiles(file).list()).toEqual(["/a/one.scxml"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ recent: ["/a/one.scxml"] });
  });

  it("survives a corrupt or foreign file, and removes and clears", () => {
    const file = tmp();
    const r = new RecentFiles(file);
    r.add("/a/one.scxml");
    writeFileSync(file, "{ not json");
    expect(new RecentFiles(file).list()).toEqual([]);
    writeFileSync(file, JSON.stringify({ recent: ["/a/ok.scxml", "/etc/passwd", 4, "/a/ok.scxml"] }));
    const again = new RecentFiles(file);
    expect(again.list()).toEqual(["/a/ok.scxml"]);
    again.add("/a/two.vt.yaml");
    again.remove("/a/ok.scxml");
    expect(again.list()).toEqual(["/a/two.vt.yaml"]);
    again.clear();
    expect(new RecentFiles(file).list()).toEqual([]);
  });
});
