import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.EDITOR_ENGINE_TEST_PORT ?? 3092);
const fixture = '/src/lib/core/document-session/browser-test/index.html';
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command:
      'bunx vite --config src/lib/core/document-session/browser-test/vite.config.ts',
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: `http://127.0.0.1:${port}${fixture}`,
    reuseExistingServer: false,
  },
});
