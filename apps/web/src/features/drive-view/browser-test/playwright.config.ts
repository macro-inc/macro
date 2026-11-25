import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = '3054';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/features/drive-view/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/src/features/drive-view/browser-test/drive-redesign.html`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
