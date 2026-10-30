import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.EMAIL_MARKETING_TEST_PORT ?? '3006';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  outputDir:
    process.env.EMAIL_MARKETING_TEST_OUTPUT ??
    join(tmpdir(), 'email-marketing-browser'),
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    // Recording needs Playwright's ffmpeg; set EMAIL_MARKETING_TEST_VIDEO=1 for the walkthrough.
    video: process.env.EMAIL_MARKETING_TEST_VIDEO ? 'on' : 'off',
    screenshot: 'only-on-failure',
    // Set this for a system or Nix Chromium; otherwise Playwright's own browser runs.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/src/features/email-marketing/browser-test/marketing.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
