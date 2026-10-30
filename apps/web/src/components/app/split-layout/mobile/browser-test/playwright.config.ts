import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);
const port = Number(process.env.CHANNEL_SWIPE_BROWSER_PORT ?? 3099);

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 45_000,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--disable-features=OverscrollHistoryNavigation'],
    },
  },
  webServer: {
    command: `bunx vite --config src/components/app/split-layout/mobile/browser-test/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
});
