import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));

export default defineConfig({
  testDir: directory,
  testMatch: [
    'coordinator.browser.e2e.ts',
    'cache-wasm-packaging.browser.e2e.ts',
  ],
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4188',
    headless: true,
  },
  webServer: {
    command: `just build-cache-wasm && bunx --bun vite --config ${JSON.stringify(`${directory}/vite.config.ts`)}`,
    cwd: webDirectory,
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
