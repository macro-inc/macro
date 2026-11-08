import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:3074',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'bunx vite --config src/session/browser-test/vite.config.ts',
    cwd: root,
    url: 'http://127.0.0.1:3074/src/session/browser-test/index.html',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
