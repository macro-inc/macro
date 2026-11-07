import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const port = Number(process.env.PORTRAIT_SCREEN_BROWSER_PORT ?? 31489);
const launchOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
};

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `bunx vite build --config src/features/computer-screen/browser-test/portrait/vite.config.ts && bunx vite preview --config src/features/computer-screen/browser-test/portrait/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
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
    {
      name: 'small-phone',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 320, height: 844 },
        defaultBrowserType: 'chromium',
        launchOptions,
      },
    },
  ],
});
