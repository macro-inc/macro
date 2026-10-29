import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.URQL_BROWSER_PORT ?? 4197);
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `bunx vite --config src/lib/urql-solid/browser-test/vite.config.ts --port ${port}`,
    cwd: web,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium' } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
