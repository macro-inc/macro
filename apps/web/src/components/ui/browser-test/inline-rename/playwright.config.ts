import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const port = process.env.INLINE_RENAME_BROWSER_PORT ?? '3008';

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
});
