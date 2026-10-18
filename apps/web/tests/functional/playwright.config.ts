import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const messaging = process.env.FUNCTIONAL_MESSAGING === '1';
const port = Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191);
const appPort = Number(process.env.FUNCTIONAL_APP_PORT ?? port + 1);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  testIgnore: messaging ? [] : ['meta-messaging.spec.ts'],
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
  webServer: [
    {
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
    ...(messaging
      ? [
          {
            cwd: fileURLToPath(new URL('../../', import.meta.url)),
            command: `bunx --bun vite preview --config tests/functional/vite.config.ts --base /app --host 127.0.0.1 --port ${appPort} --strictPort`,
            url: `http://127.0.0.1:${appPort}/app/`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: { MACRO_DEV_HTTPS: 'false' },
          },
        ]
      : []),
  ],
});
