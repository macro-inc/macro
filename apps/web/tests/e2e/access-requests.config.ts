import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'access-requests.spec.ts',
  workers: 1,
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1200, height: 850 },
        isMobile: false,
        hasTouch: false,
      },
    },
    {
      name: 'mobile-touch',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: process.env.ACCESS_REQUESTS_TEST_URL ?? 'http://localhost:3007',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: 'retain-on-failure',
  },
});
