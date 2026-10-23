import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CHANNEL_DRAFT_TEST_PORT ?? '3006';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
