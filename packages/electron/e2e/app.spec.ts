import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, ready, state, tempCopies, windowsReady } from "./launch.js";

test.describe("vertepnyk desktop", () => {
  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: e2e}
  test("opens a chart passed on the command line and one the OS asks it to open", async () => {
    const { paths } = tempCopies({ "my-chart.scxml": "order.scxml", "light.vt.yaml": "traffic-light.vt.yaml" });
    const { app, userData } = await launch([paths[0]!]);
    try {
      const [page] = await windowsReady(app, 1);
      await expect(page!.getByTestId("file-name")).toContainText("my-chart.scxml");
      await ready(page!);
      await expect(state(page!, "cart")).toBeVisible();
      // an OS-level open (macOS `open-file`, Windows/Linux second instance reach the same path)
      await app.evaluate(({ app: a }, p) => {
        a.emit("open-file", { preventDefault() {} }, p);
      }, paths[1]!);
      const pages = await windowsReady(app, 2);
      const yaml = pages.find((p) => p !== page)!;
      await expect(yaml.getByTestId("file-name")).toContainText("light.vt.yaml");
      await ready(yaml);
      await expect(state(yaml, "green")).toBeVisible();
      // the recent-files list is kept in the profile
      await expect.poll(() => JSON.parse(readFileSync(join(userData, "recent-files.json"), "utf8")).recent).toEqual(expect.arrayContaining(paths));
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:host-bridge#Hosts own the buffer#Dirty state after a visual edit]] {level: e2e}
  // @tg: verifies:: [[openspec:electron-app#Native file handling#Open from the OS]] {level: e2e}
  test("a visual edit marks the document modified; saving writes the file and changes nothing else", async () => {
    const { paths } = tempCopies({ "edit-me.scxml": "order.scxml" });
    const path = paths[0]!;
    const original = readFileSync(path, "utf8");
    const { app } = await launch([path]);
    try {
      const [page] = await windowsReady(app, 1);
      await ready(page!);
      await expect(page!.getByTestId("dirty")).toHaveCount(0);
      await page!.evaluate(() => {
        window.__vertepnyk!.handle!.controller.doc.apply({ type: "addState", parent: null, kind: "atomic", id: "from_canvas" });
      });
      await expect(page!.getByTestId("dirty")).toBeVisible();
      await expect(page!).toHaveTitle(/edit-me\.scxml ●/);
      await page!.getByTestId("save").click();
      await expect(page!.getByTestId("dirty")).toHaveCount(0);
      const saved = readFileSync(path, "utf8");
      expect(saved).toContain('id="from_canvas"');
      // automatic layout may add `vl:` attributes; apart from those and the new element the file is the original
      const stripped = saved
        .replace(/\s+vl:[\w-]+="[^"]*"/g, "")
        .replace(/\s+xmlns:vl="[^"]*"/g, "")
        .replace(/\n?[ \t]*<state id="from_canvas"[^>]*\/>/, "");
      expect(stripped).toBe(original);
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:electron-app#External changes are picked up#Git checkout while open]] {level: e2e}
  test("an unmodified chart changed on disk shows the new content", async () => {
    const { paths } = tempCopies({ "watched.scxml": "order.scxml" });
    const path = paths[0]!;
    const original = readFileSync(path, "utf8");
    const { app } = await launch([path]);
    try {
      const [page] = await windowsReady(app, 1);
      await ready(page!);
      await expect(state(page!, "refunded_elsewhere")).toHaveCount(0);
      writeFileSync(path, original.replace("</scxml>", '  <state id="refunded_elsewhere"/>\n</scxml>'));
      await expect(state(page!, "refunded_elsewhere")).toBeVisible();
      await expect(page!.getByTestId("dirty")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:electron-app#Multiple documents#Two simulations]] {level: e2e}
  test("two windows simulate independently", async () => {
    const { paths } = tempCopies({ "one.scxml": "order.scxml", "two.scxml": "order.scxml" });
    const { app } = await launch(paths);
    try {
      const pages = await windowsReady(app, 2);
      expect(pages).toHaveLength(2);
      for (const p of pages) {
        await ready(p);
        await p.getByTestId("tab-simulation").click();
        await p.getByTestId("sim-start").click();
        await expect(state(p, "cart")).toHaveAttribute("data-active", "true");
      }
      const [a, b] = pages as [typeof pages[0], typeof pages[0]];
      await a.getByTestId("event-name").fill("add");
      await a.getByTestId("send").click();
      await expect(a.getByTestId("context-row").filter({ hasText: "items" }).locator(".vd-ctxval")).toHaveText("1");
      await a.getByTestId("event-name").fill("checkout");
      await a.getByTestId("send").click();
      await expect(state(a, "awaiting_payment")).toHaveAttribute("data-active", "true");
      // the other window did not move
      await expect(state(b, "cart")).toHaveAttribute("data-active", "true");
      await expect(state(b, "awaiting_payment")).toHaveAttribute("data-active", "false");
      await expect(b.getByTestId("context-row").filter({ hasText: "items" }).locator(".vd-ctxval")).toHaveText("0");
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: e2e}
  test("the renderer has no Node.js and only the narrow files API", async () => {
    const { app } = await launch();
    try {
      const [page] = await windowsReady(app, 1);
      const r = await page!.evaluate(() => ({
        require: typeof (globalThis as { require?: unknown }).require,
        process: typeof (globalThis as { process?: unknown }).process,
        module: typeof (globalThis as { module?: unknown }).module,
        keys: Object.keys(window.vertepnykFiles ?? {}).sort(),
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
        origin: location.origin,
      }));
      expect(r.require).toBe("undefined");
      expect(r.process).toBe("undefined");
      expect(r.module).toBe("undefined");
      expect(r.keys).toEqual(["confirm", "onCommand", "onFileChanged", "onOpenRequest", "open", "openPath", "recent", "save", "saveAs", "setDirty", "unwatch", "watch"]);
      expect(r.csp).toContain("'wasm-unsafe-eval'");
      expect(r.origin).toBe("app://vertepnyk");
      const prefs = await app.evaluate(({ BrowserWindow }) => {
        const p = (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences();
        return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity };
      });
      expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:electron-app#Secure renderer#No Node in the renderer]] {level: e2e}
  test("navigation to an external URL and new windows are denied", async () => {
    const { app } = await launch();
    try {
      const [page] = await windowsReady(app, 1);
      await page!.evaluate(() => {
        location.href = "https://example.com/";
      });
      await page!.waitForTimeout(1500);
      expect(page!.url()).toMatch(/^app:\/\/vertepnyk\//);
      await page!.evaluate(() => window.open("https://example.com/", "_blank"));
      await page!.waitForTimeout(500);
      expect(app.windows()).toHaveLength(1);
      // the IPC channel refuses anything but a document path
      const err = await page!.evaluate(() =>
        (window.vertepnykFiles!.openPath as (p: string) => Promise<unknown>)("/etc/passwd").then(
          () => "resolved",
          (e: Error) => e.message,
        ),
      );
      expect(err).toContain("not a .scxml");
    } finally {
      await app.close();
    }
  });

  // @tg: verifies:: [[openspec:host-bridge#WebAssembly loads in every host#Offline start]] {level: e2e}
  test("validation and simulation work from the packaged assets (the CSP allows no remote content)", async () => {
    const { app } = await launch();
    try {
      const [page] = await windowsReady(app, 1);
      const requests: string[] = [];
      page!.on("request", (r) => requests.push(r.url()));
      await ready(page!);
      await page!.getByTestId("tab-simulation").click();
      await page!.getByTestId("sim-start").click();
      await expect(state(page!, "cart")).toHaveAttribute("data-active", "true");
      expect(requests.filter((u) => !/^(app|blob|data):/.test(u))).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
