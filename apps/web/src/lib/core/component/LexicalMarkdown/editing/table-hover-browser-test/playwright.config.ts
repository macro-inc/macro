import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const dist =
  process.env.TABLE_OVERLAYS_DIST ??
  `${web}/node_modules/.table-overlays-dist/`;
const port = Number(process.env.TABLE_OVERLAYS_PORT ?? 43794);
process.env.EDITOR_OVERLAYS_DIST = dist.endsWith('/') ? dist : dist + '/';
if (process.env.TABLE_ENGINE === 'native') process.env.DRAG_ENGINE = 'native';

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  grepInvert:
    process.env.TABLE_ENGINE === 'native'
      ? /capture the actual Source/
      : undefined,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.TABLE_TEST_OUTPUT ?? 'test-results/table-hover',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.TABLE_TEST_REPORT ?? 'test-results/table-hover.json',
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
    cwd: process.env.TABLE_SKIP_BUILD === 'true' ? dist : directory,
    command:
      process.env.TABLE_SKIP_BUILD === 'true'
        ? `python3 -m http.server ${port} --bind 127.0.0.1`
        : 'nice -n19 bunx vite build --config vite.config.ts && nice -n19 bunx vite preview --config vite.config.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
