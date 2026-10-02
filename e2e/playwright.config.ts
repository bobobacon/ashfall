import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // The dev server is started by CI / local runner before tests (see package.json)
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node packages/server/dist/main.js",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});