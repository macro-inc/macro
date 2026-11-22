import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { checkDecoratorBrowserWasm } from '../../../../../../../scripts/decorator-browser-wasm';

const WASM_HASHES = checkDecoratorBrowserWasm();

const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
export default defineConfig({
  metadata: { documentSessionWasm: WASM_HASHES },
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir: process.env.GIF_TEST_OUTPUT ?? 'test-results/gif',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: process.env.GIF_TEST_REPORT ?? 'test-results/gif.json',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:40651',
    headless: true,
    viewport: { width: 1000, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
        },
      },
    },
  ],
  webServer: {
    command:
      'MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port 40651 --strictPort',
    cwd: webDirectory,
    url: 'http://127.0.0.1:40651/app/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
