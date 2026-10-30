import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'email-folders.spec.ts',
  workers: 1,
  projects: [
    { name: 'desktop', use: { viewport: { width: 1200, height: 850 } } },
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
    baseURL: process.env.EMAIL_FOLDERS_TEST_URL ?? 'http://127.0.0.1:43190',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: 'retain-on-failure',
  },
});
