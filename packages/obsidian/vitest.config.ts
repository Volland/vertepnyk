import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["browser", "development"],
    alias: { obsidian: fileURLToPath(new URL("./test/mock-obsidian.ts", import.meta.url)) },
  },
  test: {
    name: "obsidian",
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    server: { deps: { inline: [/solid-js/] } },
  },
});
