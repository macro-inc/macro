import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const externalBaseURL = process.env.CANVAS_BROWSER_BASE_URL;
const TABLET_ONLY = '**/touch-tablet.browser.e2e.ts';
const WEBKIT_SPECS = '**/touch-taps.browser.e2e.ts';

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: externalBaseURL ?? 'http://127.0.0.1:3027',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command:
          'bunx vite --config src/features/block-canvas/browser-test/vite.config.ts',
        cwd: webDirectory,
        url: 'http://127.0.0.1:3027',
        reuseExistingServer: true,
        timeout: 90_000,
      },
  projects: [
    {
      name: 'chromium',
      testIgnore: [TABLET_ONLY, WEBKIT_SPECS],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'mobile',
      testIgnore: [TABLET_ONLY, WEBKIT_SPECS],
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      // A tablet upright: touch at a width that takes the one-row bar and the
      // side panel. Chromium, so two fingers can be sent over CDP.
      name: 'tablet',
      testMatch: TABLET_ONLY,
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 834, height: 1112 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      // The engine the iOS app and Safari run. It has no CDP, so only the
      // specs that get by with single taps run here.
      name: 'webkit',
      testMatch: WEBKIT_SPECS,
      use: { ...devices['iPhone 14'] },
    },
  ],
});
