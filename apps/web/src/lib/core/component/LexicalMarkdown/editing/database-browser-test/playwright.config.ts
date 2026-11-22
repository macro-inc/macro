import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: process.env.DATABASE_TEST_OUTPUT ?? 'test-results/database-action',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.DATABASE_TEST_REPORT ??
          'test-results/database-action.json',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:43829',
    headless: true,
    permissions: ['local-network-access'],
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
