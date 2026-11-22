import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.DRAG_OVERLAYS_PORT ?? 43793);
export default defineConfig({
  testDir: directory,
  testMatch:
    process.env.DRAG_ENGINE === 'native'
      ? ['drag-blocks.browser.e2e.ts', 'cross-editor-drag.browser.e2e.ts']
      : '*.browser.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.DRAG_TEST_OUTPUT ?? 'test-results/drag-overlays',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.DRAG_TEST_REPORT ?? 'test-results/drag-overlays.json',
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
  webServer: {
    cwd: directory,
    command:
      process.env.DRAG_SKIP_BUILD === 'true'
        ? 'nice -n19 bunx vite preview --config vite.config.ts'
        : 'nice -n19 bunx vite build --config vite.config.ts && nice -n19 bunx vite preview --config vite.config.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
