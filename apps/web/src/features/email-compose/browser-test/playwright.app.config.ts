import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.EMAIL_COMPOSE_APP_BROWSER_PORT ?? '3048';

/**
 * Fixtures that mount the real composers, editor included, through the app's
 * own Vite config. The default config's stubbed modules cannot serve them.
 */
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.app.e2e.ts',
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),
  // The first page load on a fresh checkout pre-bundles the app's dependencies.
  timeout: 240_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${port}`,
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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
