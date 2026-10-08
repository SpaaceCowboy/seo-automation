import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  globalTimeout: 300000,
  reporter: "list",
  outputDir: "../../tmp/phase7-browser",
  use: {
    baseURL: "http://127.0.0.1:3017",
    channel: "chrome",
    timezoneId: "UTC",
    headless: true,
    viewport: { width: 1440, height: 1050 },
    launchOptions: { args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @roco/dashboard exec next start --hostname 127.0.0.1 --port 3017",
    url: "http://127.0.0.1:3017/sign-in",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      DASHBOARD_ORIGIN: "http://127.0.0.1:3017",
      DASHBOARD_API_URL: "http://127.0.0.1:4017",
    },
  },
});
