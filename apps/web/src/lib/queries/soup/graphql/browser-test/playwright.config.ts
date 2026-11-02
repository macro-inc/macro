import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB = fileURLToPath(new URL('../../../../../../', import.meta.url));
export default defineConfig({
  testDir: DIRECTORY,
  testMatch: '*.browser.e2e.ts',
  timeout: 90_000,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4196', headless: true },
  webServer: {
    command: `just build-cache-wasm && bunx --bun vite --config ${JSON.stringify(`${DIRECTORY}/vite.config.ts`)}`,
    cwd: WEB,
    url: 'http://127.0.0.1:4196',
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
  ],
});
