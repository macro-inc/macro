import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const port = process.env.FAST_DECORATOR_TEST_PORT ?? '40539';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir:
    process.env.FAST_DECORATOR_TEST_OUTPUT ?? 'test-results/fast-decorators',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.FAST_DECORATOR_TEST_REPORT ??
          'test-results/fast-decorators.json',
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1000, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
        },
      },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}/app/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
