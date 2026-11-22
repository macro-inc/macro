import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Both frontends must point at the same isolated local stack, with opposite flags.
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'session.browser.e2e.ts',
  workers: 1,
  timeout: 180_000,
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
    },
  },
  projects: [
    { name: 'flag-on', use: { baseURL: process.env.EDITOR_SESSION_ON_URL } },
    { name: 'flag-off', use: { baseURL: process.env.EDITOR_SESSION_OFF_URL } },
  ],
});
