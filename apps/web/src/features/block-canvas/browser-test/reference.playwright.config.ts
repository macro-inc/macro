import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const localURL = `http://127.0.0.1:${process.env.CANVAS_REFERENCE_PORT ?? 3029}`;

export default defineConfig({
  testDir: directory,
  testMatch: 'reference.e2e.ts',
  outputDir: `${directory}/test-results`,
  reporter: 'line',
  use: { baseURL: localURL },
  webServer: {
    command:
      'bunx vite --config src/features/block-canvas/browser-test/reference.vite.config.ts',
    cwd: webDirectory,
    url: `${localURL}/reference.html`,
    reuseExistingServer: true,
    timeout: 90_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
