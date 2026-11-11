import { defineConfig } from '@playwright/test';

const port = Number(process.env.CALENDAR_DESCRIPTION_TEST_PORT ?? 43917);
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
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
    command:
      'bunx vite --config src/features/calendar/browser-test/vite.config.ts',
    cwd: new URL('../../../../', import.meta.url).pathname,
    url: `http://127.0.0.1:${port}/src/features/calendar/browser-test/description.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
