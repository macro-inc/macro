import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.RUNTIME_BROWSER_PORT ?? 3009);
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: '/tmp/runtime-overhead/browser-results',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `bunx vite --config src/lib/core/util/runtime-browser-test/vite.config.ts --port ${port}`,
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
