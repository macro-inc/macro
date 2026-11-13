import { defineConfig } from '@playwright/test';

// The real web app (a built bundle) against the real email services and the
// provider emulators. `just email-e2e-browser` builds what this needs.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  retries: 0,
  workers: Number(process.env.EMAIL_E2E_BROWSER_WORKERS ?? 4),
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
