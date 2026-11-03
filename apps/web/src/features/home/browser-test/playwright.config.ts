import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3006',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'bun --bun vite --config src/features/home/browser-test/vite.config.ts',
    url: 'http://127.0.0.1:3006',
    reuseExistingServer: !process.env.CI,
  },
});
