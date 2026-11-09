import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.EDITOR_BEHAVIOR_PORT ?? 43183);

export default defineConfig({
  testDir: DIRECTORY,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir:
    process.env.EDITOR_BEHAVIOR_OUTPUT ??
    join(tmpdir(), 'editor-behavior-browser'),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.EDITOR_BEHAVIOR_JSON ??
          join(tmpdir(), 'editor-behavior-browser.json'),
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'tablet',
      use: { viewport: { width: 1024, height: 900 }, hasTouch: true },
    },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    cwd: DIRECTORY,
    command:
      'bunx vite build --config vite.config.ts && bunx vite preview --config vite.config.ts',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
