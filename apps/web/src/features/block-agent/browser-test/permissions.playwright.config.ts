import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = Number(process.env.PERMISSIONS_BROWSER_PORT ?? 3072);
export default defineConfig({
  ...base,
  testMatch: 'permissions.browser.e2e.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `bunx vite --config src/features/block-agent/browser-test/permissions.vite.config.ts --port ${port}`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
