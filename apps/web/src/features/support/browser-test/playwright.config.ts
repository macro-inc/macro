import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.ts',
  timeout: 120000,
  workers: 1,
  outputDir: 'test-results/support',
  use: {
    actionTimeout: 15000,
    baseURL: 'http://localhost:4177',
    viewport: { width: 1440, height: 960 },
    video: { mode: 'on', size: { width: 1440, height: 960 } },
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: new URL('../../../../', import.meta.url).pathname,
    command:
      'bunx vite --config src/features/support/browser-test/vite.config.ts',
    url: 'http://localhost:4177/src/features/support/browser-test/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
