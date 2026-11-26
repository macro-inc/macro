import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CHANGES_TEST_PORT ?? '3007';
const external = process.env.CHANGES_TEST_EXISTING_SERVER === '1';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1400, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: external
    ? undefined
    : {
        command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        url: `http://localhost:${port}/app/`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
