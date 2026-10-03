import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.EMAIL_MARKETING_TEST_PORT ?? '3006';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: fileURLToPath(
    new URL('../../../../../../work/email-marketing-browser', import.meta.url)
  ),
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    video: 'on',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    },
  },
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://localhost:${port}/src/features/email-marketing/browser-test/marketing.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
