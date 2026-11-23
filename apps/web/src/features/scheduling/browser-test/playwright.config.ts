import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.SCHEDULING_BROWSER_PORT ?? '3093';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  // A cold dev server compiles the app's modules on the first load.
  timeout: 180000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/features/scheduling/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
