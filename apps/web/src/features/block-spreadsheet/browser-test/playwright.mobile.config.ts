import { defineConfig, devices } from '@playwright/test';
import desktop from './playwright.config';

export default defineConfig({
  ...desktop,
  testMatch: '*.mobile.e2e.ts',
  outputDir: `${desktop.outputDir}/mobile`,
  projects: [
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'iphone-webkit',
      use: {
        ...devices['iPhone 13'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
