import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const port = Number(process.env.COMMENT_BROWSER_PORT ?? 3068);

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  workers: 1,
  reporter: 'line',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `bunx vite --config src/lib/core/messages/browser-test/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
