import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const PORT = process.env.PASSWORDS_TEST_PORT ?? '3538';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${PORT} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
