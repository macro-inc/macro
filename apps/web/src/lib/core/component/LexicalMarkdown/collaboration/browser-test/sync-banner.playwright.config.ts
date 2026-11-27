import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const dir = 'src/lib/core/component/LexicalMarkdown/collaboration/browser-test';
const port = process.env.SYNC_BANNER_TEST_PORT ?? '3064';

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  outputDir: fileURLToPath(
    new URL('../../../../../../../test-results/sync-banner', import.meta.url)
  ),
  testMatch: 'sync-banner.browser.e2e.ts',
  workers: 1,
  timeout: 140_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `MACRO_DEV_HTTPS=false MACRO_DEV_PROXY=false bunx vite --host 127.0.0.1 --port ${port} --strictPort --config ${dir}/sync-banner.vite.config.ts`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}/${dir}/sync-banner.html`,
    reuseExistingServer: false,
    timeout: 120_000,
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
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 14'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
