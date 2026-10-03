import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3018',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'bunx vite --config src/features/block-docx/browser-test/vite.config.ts',
    cwd: webDirectory,
    url: 'http://127.0.0.1:3018',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
