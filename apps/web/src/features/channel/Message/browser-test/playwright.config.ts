import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CHANNEL_MESSAGE_TEST_PORT ?? '3051';

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    // The fixture shows the cards, which `enable-link-previews` gates.
    command: `MACRO_DEV_HTTPS=false VITE_ENABLE_LINK_PREVIEWS=true bunx vite --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
