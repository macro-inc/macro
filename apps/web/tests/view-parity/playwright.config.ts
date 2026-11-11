import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const launchOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
};

/**
 * Compares two builds of the frontend on one backend. See README.md.
 *
 * `hasTouch` has to be set when the context is created: the app reads
 * `(pointer: coarse)` at boot to pick mobile views and `touch:` styles.
 */
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'parity.spec.ts',
  outputDir: process.env.PARITY_OUTPUT ?? '/tmp/view-parity',
  // The first load of a dev build compiles and serves thousands of modules.
  timeout: 900_000,
  expect: { timeout: 120_000 },
  // Chromium drops in-flight requests when a network interface changes, which
  // a machine running several Docker stacks does often.
  retries: 3,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet',
      use: {
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
