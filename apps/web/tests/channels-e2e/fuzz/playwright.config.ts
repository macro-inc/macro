import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { runDirectory, workers } from '../harness/stack';

// The differential fuzzer: random sequences of channel operations, run
// against whichever build the stack serves. README.md says how to run both
// builds and compare them.

/** A trace of every sequence (`all`), of those that fail, or of none. */
function traces(): 'on' | 'retain-on-failure' | 'off' {
  if (process.env.FUZZ_TRACE === 'all') return 'on';
  return process.env.FUZZ_TRACE ? 'retain-on-failure' : 'off';
}
export default defineConfig({
  testDir: '.',
  testMatch: 'differential.fuzz.ts',
  outputDir: join(runDirectory(), 'test-results'),
  // A sequence of forty operations takes a few minutes; a long channel more.
  timeout: 25 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: workers(),
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: join(runDirectory(), 'playwright-report.json') }],
  ],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.CHANNELS_E2E_STACK_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    // A trace of four windows over forty operations is large: kept only
    // for a run asked to fail on what it finds, which is how a shrunk
    // sequence is recorded.
    trace: traces(),
    video: 'off',
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
