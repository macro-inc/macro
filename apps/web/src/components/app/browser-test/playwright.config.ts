import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.APP_SMOKE_BROWSER_PORT ?? 3097);
const existing = process.env.APP_SMOKE_BASE_URL;

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: existing ?? `http://127.0.0.1:${port}`,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: existing
    ? undefined
    : {
        command: `bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: webDirectory,
        env: {
          MACRO_DEV_HTTPS: 'false',
          VITE_LOCAL_SERVERS: 'ALL',
          VITE_LOCAL_BACKEND_ORIGIN: 'http://127.0.0.1:9',
          VITE_ENABLE_BROWSER_OTEL: 'false',
          VITE_POSTHOG_API_KEY: '',
        },
        url: `http://127.0.0.1:${port}/app/`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
