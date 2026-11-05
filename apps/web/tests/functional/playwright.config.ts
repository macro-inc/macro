import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Under CPU pressure about 0.3% of these tests miss a deadline (seen at both 4
  // and 8 workers on 8 CPUs), which fails about one full run in five. A retried
  // test still shows as flaky in the output.
  retries: process.env.CI ? 1 : 0,
  workers: Number(process.env.FUNCTIONAL_TEST_WORKERS ?? 1),
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command:
      'just ensure-cache-wasm && bunx --bun vite build --config tests/functional/vite.config.ts && bunx --bun vite preview --config tests/functional/vite.config.ts',
    url: `http://127.0.0.1:${port}/tests/functional/optimistic-mutations/index.html`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      MODE: 'development',
      NODE_ENV: 'production',
      FUNCTIONAL_TEST_PORT: String(port),
      MACRO_DEV_HTTPS: 'false',
      VITE_LOCAL_SERVERS: 'ALL',
      VITE_LOCAL_BACKEND_ORIGIN: 'same-origin',
      VITE_ENABLE_GRAPHQL_SOUP: 'true',
      VITE_ENABLE_BROWSER_OTEL: 'false',
    },
  },
});
