import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.pw.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:24821', trace: 'retain-on-failure' },
  webServer: {
    command: 'bun run viewer --port 24821 --strictPort',
    url: 'http://127.0.0.1:24821',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  snapshotPathTemplate: '{testDir}/snapshots/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled' } },
});
