import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: '/tmp/macro-link-preview-browser',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3007',
    viewport: { width: 1100, height: 940 },
    video: { mode: 'on', size: { width: 1100, height: 940 } },
    trace: 'retain-on-failure',
    channel: 'chrome',
  },
  webServer: {
    command:
      'bunx vite --config src/features/channel/Message/browser-test/vite.config.ts',
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    url: 'http://127.0.0.1:3007',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
