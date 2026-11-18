import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.NATIVE_FORMAT_PORT ?? 49507);

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  outputDir: process.env.NATIVE_FORMAT_OUTPUT,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.NATIVE_FORMAT_REPORT }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'on',
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
    command: 'bunx vite preview --host 127.0.0.1 --config vite.config.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
