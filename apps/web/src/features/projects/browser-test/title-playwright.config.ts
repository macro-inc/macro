import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.PROJECT_TITLE_TEST_PORT ?? '3694';

export default defineConfig({
  testDir: directory,
  testMatch: 'title-menu.browser.e2e.ts',
  outputDir: '/tmp/project-title-results',
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: `bunx vite --config src/features/projects/browser-test/title-vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}/title.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
