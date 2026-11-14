import { defineConfig } from '@playwright/test';
import { currentRun, runPaths } from './ledger/paths';

// The real web app (a built bundle) against the real email services and the
// provider emulators. `just email-e2e-browser` builds what this needs.

// Tests run on a stack of their own unless a tag says otherwise.
// `@any-stack`: also on the local stack (`just email-e2e-full-stack`), with
// its real gateway, sign-in and proxy. `@full-stack`: only there, for the
// services no stack of a test's own runs.
const ON_LOCAL_STACK = !!process.env.EMAIL_E2E_STACK_PROXY_URL;
const HERE = ON_LOCAL_STACK ? /@(any|full)-stack/ : undefined;
const NOT_HERE = ON_LOCAL_STACK ? [] : [/@full-stack/];
const KNOWN_BUGS_HERE = ON_LOCAL_STACK
  ? /(?=.*@known-bug)(?=.*@(any|full)-stack)/
  : /@known-bug/;
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // In CI the fixture suites run beside this one; a test that lost a wait to
  // that load is retried once and reported as flaky.
  retries: process.env.CI ? 1 : 0,
  // A test of a bug that is not fixed yet asserts the right behaviour and is
  // tagged `@known-bug`: left out here, run alone with EMAIL_E2E_KNOWN_BUGS=1.
  grep: process.env.EMAIL_E2E_KNOWN_BUGS ? KNOWN_BUGS_HERE : HERE,
  grepInvert: process.env.EMAIL_E2E_KNOWN_BUGS
    ? NOT_HERE
    : [/@known-bug/, ...NOT_HERE],
  workers: Number(process.env.EMAIL_E2E_BROWSER_WORKERS ?? 4),
  forbidOnly: !!process.env.CI,
  // The JSON report is what the coverage report reads test results from.
  reporter: [
    ['list'],
    ['json', { outputFile: runPaths(currentRun()).playwright }],
  ],
  globalSetup: './global-setup.ts',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    // The local stack's storage is behind its HTTPS proxy, whose certificate
    // the development authority signs and no browser trusts.
    ignoreHTTPSErrors: ON_LOCAL_STACK,
    launchOptions: {
      // The app is served to the page by the test process (`fixtures.ts`), so
      // Chrome takes it for a public site and refuses it sockets to localhost.
      args: ['--disable-features=LocalNetworkAccessChecks'],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
