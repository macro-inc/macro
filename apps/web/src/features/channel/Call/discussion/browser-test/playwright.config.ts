import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CALL_THREAD_TEST_PORT ?? '3071';
const fullHost = process.env.CALL_FULL_HOST === 'true';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  grep: fullHost
    ? /composer stays|call discussion keeps|registered work gating|20px icon|toggle icon|pinning matrix|call self view|companion controls|explicit reply|reply quotes in place|sending from the panel|rebuilt call|blocked media/
    : undefined,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite ${fullHost ? '--config src/features/channel/Call/discussion/browser-test/overlay.vite.config.ts' : ''} --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    url: `http://localhost:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
