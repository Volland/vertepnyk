import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "electron", include: ["test/**/*.test.ts"], environment: "node" },
});
