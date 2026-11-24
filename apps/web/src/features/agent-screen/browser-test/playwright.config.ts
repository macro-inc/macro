import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.AGENT_SCREEN_BROWSER_PORT ?? '3083';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60000,
  // The first page waits for Vite to optimize the app's dependencies.
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --config src/features/agent-screen/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
