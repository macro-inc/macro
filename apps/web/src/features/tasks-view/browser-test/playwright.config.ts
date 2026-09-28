import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const port = process.env.TASK_PROPERTY_TEST_PORT ?? '3004';

// Build the current WASM first: just build-cache-wasm (from apps/web).
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `bunx vite --port ${port}`,
    cwd: webDirectory,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
