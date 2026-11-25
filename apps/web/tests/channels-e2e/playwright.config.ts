import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { runDirectory, workers } from './harness/stack';

// The real web app against a whole running stack, with several people signed
// in. `just apps/web/test-channels-e2e <instance>` runs it against a local
// stack; README.md says how to point it anywhere else.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(runDirectory(), 'test-results'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Tests share the stack and its people but never a channel: each makes its
  // own, so files can run side by side.
  fullyParallel: true,
  workers: workers(),
  retries: 0,
  forbidOnly: !!process.env.CI,
  // The JSON report is what the coverage ledger reads results from.
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: join(runDirectory(), 'playwright-report.json'),
      },
    ],
  ],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.CHANNELS_E2E_STACK_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CHANNELS_E2E_VIDEO ? 'on' : 'off',
    // A local stack's proxy has a certificate signed by the development
    // authority, which no browser trusts.
    ignoreHTTPSErrors: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
