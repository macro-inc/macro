import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const external = process.env.CANVAS_RENDER_BASE_URL;
export default defineConfig({
  testDir: directory,
  testMatch: 'text-layout.browser.e2e.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  outputDir: `${directory}/test-results`,
  use: {
    baseURL: external ?? 'http://127.0.0.1:3028',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : {
        command: 'bunx vite --config vite.config.ts --port 3028',
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        url: 'http://127.0.0.1:3028/canvas-render.html',
        reuseExistingServer: true,
        timeout: 90_000,
      },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
