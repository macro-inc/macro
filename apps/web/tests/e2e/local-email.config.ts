import { defineConfig, devices } from '@playwright/test';

/**
 * Email against a full local stack whose Google is `crates/gmail_emulator`.
 * Run through `just local-e2e-email`, which starts the stack without
 * Doppler (so the emulators stand in for Google and Microsoft) and sets
 * `LOCAL_EMAIL_E2E_APP_URL` (the stack's own frontend) and
 * `GMAIL_EMULATOR_URL` (the emulator's sign-in page and control API). Specs
 * sign in with Google as one of the emulator's seeded users.
 */
const appURL = process.env.LOCAL_EMAIL_E2E_APP_URL;
if (!appURL || !process.env.GMAIL_EMULATOR_URL) {
  throw new Error(
    'LOCAL_EMAIL_E2E_APP_URL and GMAIL_EMULATOR_URL are required. Run `just local-e2e-email`.'
  );
}

export default defineConfig({
  testDir: './email-live',
  testMatch: '**/*.live.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `${appURL.replace(/\/$/, '')}/`,
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: 'retain-on-failure',
  },
});
