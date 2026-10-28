import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.I18N_MENUS_TEST_PORT ?? '3048';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'line',
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    // Tall enough that no open menu is shifted to fit, so none overlap.
    viewport: { width: 1920, height: 6000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/lib/i18n/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
