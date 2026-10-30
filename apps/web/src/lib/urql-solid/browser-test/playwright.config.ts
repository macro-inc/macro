import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(new URL('../../../../', import.meta.url));
const PORT = Number(process.env.URQL_BROWSER_PORT ?? 4197);
export default defineConfig({
  testDir: DIRECTORY,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${DIRECTORY}/test-results`,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `bunx vite --config src/lib/urql-solid/browser-test/vite.config.ts --port ${PORT}`,
    cwd: WEB_DIRECTORY,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium' } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
