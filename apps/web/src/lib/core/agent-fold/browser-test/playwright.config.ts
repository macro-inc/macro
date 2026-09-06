import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const root = fileURLToPath(new URL('../../../../../../../', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4193',
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command:
      'just --justfile apps/web/justfile ensure-agent-fold-wasm && python3 -m http.server 4193 --bind 127.0.0.1',
    timeout: 180_000,
    cwd: root,
    url: 'http://127.0.0.1:4193',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
