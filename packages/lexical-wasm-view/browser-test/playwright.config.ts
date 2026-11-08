import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3076',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'bunx vite --config browser-test/vite.config.ts',
    cwd: new URL('..', import.meta.url).pathname,
    url: 'http://127.0.0.1:3076/browser-test/index.html',
    reuseExistingServer: false,
  },
});
