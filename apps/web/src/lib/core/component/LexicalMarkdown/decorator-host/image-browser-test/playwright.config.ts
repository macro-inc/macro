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
  outputDir: process.env.IMAGE_TEST_OUTPUT ?? 'test-results/image',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: process.env.IMAGE_TEST_REPORT ?? 'test-results/image.json',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:40617',
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
      'MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port 40617 --strictPort',
    cwd: webDirectory,
    url: 'http://127.0.0.1:40617/app/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
