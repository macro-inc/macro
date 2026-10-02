import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
export default defineConfig({
  testDir: directory,
  testMatch: 'optimistic-interface.browser.e2e.ts',
  timeout: 90_000,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4196', headless: true },
  webServer: {
    command:
      'bunx vite --config src/lib/graphql-cache/worker/browser-test/vite.optimistic.config.ts',
    cwd: webDirectory,
    url: 'http://127.0.0.1:4196/optimistic-interface.html',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
