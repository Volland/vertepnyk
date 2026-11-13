import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["browser", "development"] },
  test: { name: "designer", include: ["test/**/*.test.{ts,tsx}"], environment: "happy-dom", testTimeout: 30000, hookTimeout: 30000, setupFiles: ["test/setup.ts"], server: { deps: { inline: [/solid-js/], external: [/vertep\/bindings\/js/] } } },
});
