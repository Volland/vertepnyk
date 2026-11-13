import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "vscode", include: ["test/unit/**/*.test.ts"], environment: "node" },
});
