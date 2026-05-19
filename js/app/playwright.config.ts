import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

const isLocalE2E = process.env.LOCAL_E2E === 'true';
const localE2EPort = process.env.PORT ?? '3000';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandOutput(error: unknown): string {
  const processError = error as {
    message?: string;
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };

  const stdout = processError.stdout?.toString().trim();
  const stderr = processError.stderr?.toString().trim();
  return [stderr, stdout, processError.message].filter(Boolean).join('\n');
}

function localE2EToken(): string {
  if (process.env.LOCAL_JWT) {
    return process.env.LOCAL_JWT;
  }

  try {
    return execFileSync('bun', ['scripts/generate-local-e2e-token.ts'], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const details = commandOutput(error);
    const message = [
      'Failed to generate LOCAL_JWT for LOCAL_E2E Playwright.',
      'Prefer running the repo-level harness: `just local-e2e`.',
      'If you are running Playwright directly, run `just local-e2e-seed` first and ensure `.env` exists from `just get_environment`.',
      'You can also bypass token generation by exporting LOCAL_JWT.',
      details ? `Generator output:\n${details}` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');

    console.error(message);
    throw new Error(message);
  }
}

function localE2EWebServerCommand(): string {
  return [
    `PORT=${shellQuote(localE2EPort)}`,
    'VITE_LOCAL_SERVERS=ALL',
    'VITE_ENABLE_BEARER_TOKEN_AUTH=true',
    `LOCAL_JWT=${shellQuote(localE2EToken())}`,
    'bun run dev',
  ].join(' ');
}

function ciPreviewWebServerCommand(): string {
  return [
    `PORT=${shellQuote(localE2EPort)}`,
    'bunx vite preview -c packages/app/vite.config.ts --outDir packages/app/dist',
  ].join(' ');
}

const authenticatedProjects = isLocalE2E
  ? [
      {
        name: 'local-chromium',
        use: {
          ...devices['Desktop Chrome'],
        },
      },
    ]
  : [
      { name: 'setup', testMatch: /.*setup.ts/ },
      // {
      //   name: 'editor',
      //   use: {
      //     ...devices['Desktop Chrome'],
      //     storageState: 'playwright/.auth/user.json',
      //     launchOptions: {
      //       /* This makes it so that layout that relies on a scrollbar renders correctly */
      //       ignoreDefaultArgs: ['--hide-scrollbars'],
      //     },
      //   },
      //   dependencies: ['setup'],
      //   // editor tests shouldn't ever run more than 15 seconds without cache
      //   timeout: 15000,
      // },
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          storageState: 'playwright/.auth/user.json',
        },
        dependencies: ['setup'],
      },
      {
        name: 'firefox',
        use: {
          ...devices['Desktop Firefox'],
          storageState: 'playwright/.auth/user.json',
        },
        dependencies: ['setup'],
      },
      {
        name: 'webkit',
        use: {
          ...devices['Desktop Safari'],
          storageState: 'playwright/.auth/user.json',
        },
        dependencies: ['setup'],
      },
    ];

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'tests/e2e/pdf/inputs/*',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [['list', { printSteps: true }], ['html'], ['github']]
    : 'list',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: `http://localhost:${localE2EPort}/app`,
    /* Only retain traces on the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
  },
  // One set of snapshots for all platforms
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  /* Configure projects for major browsers */
  projects: [
    ...authenticatedProjects,

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  // some viewer tests are _very_ slow, because they hit the actual API and all get a 401, and re-requesting after a new takes 5-10 seconds:
  // topbar, sidepanel seem to be the worst ones
  // timeout: 30000,

  // expect: {
  //   toHaveScreenshot: {
  //     stylePath: 'tests/e2e/stable.css',
  //   },
  // },

  /* Run your local dev server before starting the tests */
  webServer: {
    command: isLocalE2E
      ? localE2EWebServerCommand()
      : process.env.CI
        ? ciPreviewWebServerCommand()
        : 'bun run dev',
    url: `http://localhost:${localE2EPort}/app`,
    reuseExistingServer: !process.env.CI && !isLocalE2E,
    timeout: isLocalE2E ? 60_000 : 15000,
  },
});
