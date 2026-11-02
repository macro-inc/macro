import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.ACTIVITY_BROWSER_PORT ?? 3021);
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  expect: { timeout: 15000 },
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `bunx vite --config src/features/activity/browser-test/vite.config.ts --port ${port}`,
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
});
