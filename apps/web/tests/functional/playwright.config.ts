import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
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
      'just ensure-cache-wasm && bunx --bun vite --config tests/functional/vite.config.ts',
    url: `http://127.0.0.1:${port}/tests/functional/optimistic-mutations/index.html`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      FUNCTIONAL_TEST_PORT: String(port),
      MACRO_DEV_HTTPS: 'false',
      VITE_LOCAL_SERVERS: 'ALL',
      VITE_LOCAL_BACKEND_ORIGIN: 'same-origin',
      VITE_ENABLE_GRAPHQL_SOUP: 'true',
      VITE_ENABLE_BROWSER_OTEL: 'false',
    },
  },
});
