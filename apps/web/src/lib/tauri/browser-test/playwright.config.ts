import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(new URL('../../../../', import.meta.url));
const PORT = Number(process.env.NOTIFICATION_COVER_BROWSER_PORT ?? 3008);

export default defineConfig({
  testDir: DIRECTORY,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${DIRECTORY}/test-results`,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `bunx --bun vite --config src/lib/tauri/browser-test/vite.config.ts --port ${PORT}`,
    cwd: WEB_DIRECTORY,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
});
