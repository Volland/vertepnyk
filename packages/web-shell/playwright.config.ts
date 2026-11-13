import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5199);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"], headless: true, viewport: { width: 1400, height: 860 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: ".",
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PORT: String(port) },
  },
});
