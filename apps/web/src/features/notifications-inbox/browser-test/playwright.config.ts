import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.GROUP_CHAT_ROWS_TEST_PORT ?? '3051';

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),
  workers: 1,
  // The first page load on a fresh checkout pre-bundles the app's dependencies.
  timeout: 240_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
