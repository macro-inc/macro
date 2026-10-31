import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);
const localURL = `http://127.0.0.1:${process.env.LEXICAL_FUZZ_PORT ?? 3017}`;

export default defineConfig({
  testDir: directory,
  testMatch: '*.browser.e2e.ts',
  outputDir: `${directory}/test-results`,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: localURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'bunx vite --config src/lib/core/component/LexicalMarkdown/fuzz/vite.config.ts',
    cwd: webDirectory,
    url: localURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 900, height: 700 },
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
