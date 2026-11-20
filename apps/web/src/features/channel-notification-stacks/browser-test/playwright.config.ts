import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.CHANNEL_GUTTER_TEST_PORT ?? 3053);
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  // The first page load on a fresh checkout pre-bundles the app's dependencies.
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `bunx vite --config src/features/channel-notification-stacks/browser-test/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}/gutter.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  // Desktop only: the channel mounts none of this on a touch device.
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1700, height: 900 },
      },
    },
  ],
});
