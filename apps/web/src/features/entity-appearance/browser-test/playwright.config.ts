import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = process.env.ENTITY_APPEARANCE_TEST_PORT ?? '3508';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    actionTimeout: 15_000,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    {
      name: 'small-phone',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 320, height: 700 },
        defaultBrowserType: 'chromium',
      },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/features/entity-appearance/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
