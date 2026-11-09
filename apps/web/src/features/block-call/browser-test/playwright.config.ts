import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CALL_PLAYBACK_TEST_PORT ?? '3078';
const config = 'src/features/block-call/browser-test/vite.config.ts';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      // Fullscreen wheel hit testing uses the native window, not the emulated viewport.
      args: ['--window-size=1920,1080'],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: `bunx vite build --config ${config} && bunx vite preview --config ${config} --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    url: `http://localhost:${port}/src/features/block-call/browser-test/playback.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
