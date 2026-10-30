import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.CALENDAR_NOTES_BROWSER_PORT ?? 3097);
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 45_000,
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `bunx vite --config src/features/calendar-notes/browser-test/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
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
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
