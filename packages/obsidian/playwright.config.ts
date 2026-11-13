import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], headless: true, viewport: { width: 1000, height: 1100 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
