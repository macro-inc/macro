import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const port = Number(process.env.CRM_ARCHIVE_BROWSER_PORT ?? 23943);
const launchOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
};

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: process.env.CRM_ARCHIVE_PROOF_DIR ?? `${directory}/test-results`,
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    video: 'on',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bunx vite build --config src/features/crm/browser-test/archive/vite.config.ts && bunx vite preview --config src/features/crm/browser-test/archive/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    {
      name: 'phone',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        launchOptions,
      },
    },
  ],
});
