import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.WIDE_MODE_TEST_PORT ?? '3531';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit', viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${PORT} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
