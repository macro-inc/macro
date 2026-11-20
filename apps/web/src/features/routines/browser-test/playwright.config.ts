import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const WEB_DIRECTORY = fileURLToPath(new URL('../../../../', import.meta.url));
const PORT = process.env.ROUTINE_CODE_BROWSER_PORT ?? '3076';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  // The first page load on a fresh checkout pre-bundles the app's dependencies.
  timeout: 240_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/features/routines/browser-test/vite.config.ts --port ${PORT} --strictPort`,
    cwd: WEB_DIRECTORY,
    url: `http://localhost:${PORT}/app/`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
