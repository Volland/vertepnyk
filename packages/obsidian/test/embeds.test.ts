import { describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";
import { embedPostProcessor, registerEmbedCreator } from "../src/embeds.js";
import { TRAFFIC_SCXML, TRAFFIC_YAML, loadPlugin } from "./helpers.js";

/** What Obsidian leaves for `![[file]]` of a type it does not render: `span.internal-embed[src]` in a paragraph. */
function embedDom(src: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<p><span class="internal-embed file-embed mod-empty is-loaded" src="${src}" alt="${src}">${src}</span></p>`;
  return el;
}

async function run(src: string, files: Record<string, string>) {
  const { app, plugin } = await loadPlugin();
  for (const [p, t] of Object.entries(files)) app.vault.add(p, t);
  const el = embedDom(src);
  const root = new Component();
  root.load();
  const ctx = { sourcePath: "notes/n.md", addChild: (c: Component) => root.addChild(c) };
  const pp = plugin.postProcessors[0]!;
  pp(el, ctx);
  return { app, plugin, el, root, ctx, pp };
}

describe("chart embeds", () => {
  // @tg: verifies:: [[openspec:obsidian-plugin#Embeds and links#Embed a chart file]] {level: integration}
  it("replaces an scxml embed with the chart", async () => {
    const { el } = await run("order.scxml", { "charts/order.scxml": TRAFFIC_SCXML });
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
    expect(el.querySelector(".internal-embed")!.classList.contains("vertepnyk-embed")).toBe(true);
    expect(el.querySelector(".vertepnyk-block-title")!.textContent).toBe("order.scxml");
    expect(el.querySelector(".vt-toolbar")).toBeNull();
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Embeds and links#Embed a chart file]] {level: integration}
  it("embeds a .vt.yaml file, with a heading or alias in the link", async () => {
    const { el } = await run("light.vt.yaml#top|small", { "light.vt.yaml": TRAFFIC_YAML });
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Embeds and links#Embed a chart file]] {level: unit}
  it("leaves embeds of other files and missing charts alone", async () => {
    const a = await run("pic.png", { "pic.png": "x" });
    expect(a.el.querySelector(".vertepnyk-block")).toBeNull();
    const b = await run("missing.scxml", {});
    expect(b.el.querySelector(".vertepnyk-block")).toBeNull();
    expect(b.el.querySelector(".internal-embed")!.textContent).toBe("missing.scxml");
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Embeds and links#Embed a chart file]] {level: unit}
  it("does not embed twice and follows changes to the file", async () => {
    const { app, el, pp, ctx } = await run("order.scxml", { "order.scxml": TRAFFIC_SCXML });
    await vi.waitFor(() => expect(el.querySelectorAll(".vt-state").length).toBeGreaterThan(5));
    pp(el, ctx);
    expect(el.querySelectorAll(".vertepnyk-block")).toHaveLength(1);
    const file = app.vault.tfiles.get("order.scxml")!;
    await app.vault.modify(file, `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="only"><state id="only"/></scxml>`);
    await vi.waitFor(() => expect([...el.querySelectorAll(".vt-name")].map((n) => n.textContent)).toEqual(["only"]));
  });

  // @tg: verifies:: [[openspec:obsidian-plugin#Embeds and links#Embed a chart file]] {level: unit}
  it("registers with Obsidian's embed registry when the app has one, and not otherwise", async () => {
    const { app, plugin } = await loadPlugin();
    expect(registerEmbedCreator(plugin)).toBe(false);
    const seen: string[][] = [];
    (app as unknown as { embedRegistry: unknown }).embedRegistry = { registerExtensions: (e: string[]) => seen.push(e) };
    expect(registerEmbedCreator(plugin)).toBe(true);
    expect(seen).toEqual([["scxml"]]);
    expect(embedPostProcessor).toBeTypeOf("function");
  });
});
