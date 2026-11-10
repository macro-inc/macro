import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.NATIVE_OVERLAYS_PORT ?? 43583);
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: DIRECTORY,
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 30_000,
  outputDir:
    process.env.NATIVE_OVERLAYS_OUTPUT ??
    join(tmpdir(), 'native-overlay-browser'),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.NATIVE_OVERLAYS_JSON ??
          join(tmpdir(), 'native-overlay-browser.json'),
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath: CHROMIUM },
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
    {
      name: 'chromium-tablet',
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 900 },
        hasTouch: true,
        launchOptions: { executablePath: CHROMIUM },
      },
    },
    {
      name: 'chromium-phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
        launchOptions: { executablePath: CHROMIUM },
      },
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
