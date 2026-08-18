import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));

export default defineConfig({
  testDir: directory,
  testMatch: [
    'coordinator.browser.e2e.ts',
    'cache-wasm-packaging.browser.e2e.ts',
    'cache-lifecycle.browser.e2e.ts',
  ],
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4189/app/',
    headless: true,
  },
  webServer: {
    command:
      'just build-cache-wasm-browser-production && node scripts/cache-wasm/precompressed-preview-server.mjs src/lib/graphql-cache/worker/browser-test/.dist-production',
    cwd: webDirectory,
    url: 'http://127.0.0.1:4189/app/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium-production',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'firefox-production',
      use: {
        browserName: 'firefox',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
