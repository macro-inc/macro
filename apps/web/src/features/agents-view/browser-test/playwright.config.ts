import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.AGENTS_VIEW_BROWSER_PORT ?? 3018);
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 30_000,
  workers: 1,
  reporter: 'line',
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `bunx vite --config src/features/agents-view/browser-test/vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  // The fixture mounts the desktop composer; the phone composer is not covered.
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
