import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:3000/app',
    /* Only retain traces on the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
  },
  // One set of snapshots for all platforms
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  /* Configure projects for major browsers */
  projects: [
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
    command: process.env.CI
      ? 'bunx vite preview -c packages/app/vite-ci.config.ts --outDir packages/app/dist'
      : 'bun run dev',
    url: 'http://localhost:3000/app',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
