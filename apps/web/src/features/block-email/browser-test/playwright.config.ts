import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.EMAIL_THREAD_BROWSER_PORT ?? '3084';

/**
 * Fixtures that mount the real thread view through the app's own Vite
 * config. Desktop only: touch devices have no Space key and no hotkey root.
 */
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),
  // The first page load on a fresh checkout pre-bundles the app's dependencies.
  timeout: 240_000,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
