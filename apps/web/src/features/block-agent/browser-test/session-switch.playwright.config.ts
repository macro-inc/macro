import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.SESSION_SWITCH_BROWSER_PORT ?? 3072);
export default defineConfig({
  ...base,
  testMatch: 'session-switch.browser.e2e.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  // Hover is the signal under test; touch has none.
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx vite --config src/features/block-agent/browser-test/session-switch.vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
