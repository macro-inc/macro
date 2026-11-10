import { defineConfig } from '@playwright/test';

const port = Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 40731);
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'normal-enter.browser.e2e.ts',
  workers: 1,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.NATIVE_ENTER_REPORT ?? 'test-results/normal-enter.json',
      },
    ],
  ],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
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
    command:
      'bunx vite build --config browser-test/normal-enter.vite.config.ts && bunx vite preview --config browser-test/normal-enter.vite.config.ts',
    cwd: new URL('..', import.meta.url).pathname,
    url: `http://127.0.0.1:${port}/browser-test/normal-enter.html`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
