import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["browser", "development"] },
  test: { name: "inspector", include: ["test/**/*.test.{ts,tsx}"], environment: "happy-dom", server: { deps: { inline: [/solid-js/] } } },
});
