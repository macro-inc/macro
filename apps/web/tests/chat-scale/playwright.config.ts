import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/** Everything a run leaves: the measurements (`results.json`), the report
 * the nightly's alert reads, and a failed size's screenshot and requests.
 * CI uploads the directory. */
const RUN_DIR = fileURLToPath(
  new URL('../../.cache/chat-scale/', import.meta.url)
);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Each size seeds its channels into the browser's cache before it measures.
  timeout: 900_000,
  expect: { timeout: 60_000 },
  // The sizes compare with each other, so they run in order, on one worker,
  // never beside another page competing for the CPU.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: `${RUN_DIR}test-results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${RUN_DIR}playwright-report.json` }],
  ],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    // A trace records every frame and response, which is work the measured
    // page would be doing.
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        // The page's origin is a loopback address.
        '--disable-features=LocalNetworkAccessChecks',
        // `measureUserAgentSpecificMemory` answers now, not at the next
        // collection.
        '--enable-blink-features=ForceEagerMeasureMemory',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
