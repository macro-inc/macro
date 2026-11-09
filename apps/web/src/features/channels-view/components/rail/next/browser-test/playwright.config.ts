import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = process.env.CHAT_SIDEBAR_TEST_PORT ?? '3057';
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: 'desktop-dark', use: { viewport: { width: 1280, height: 1000 } } },
    {
      name: 'desktop-light',
      use: { viewport: { width: 1280, height: 1000 }, colorScheme: 'light' },
    },
    {
      name: 'phone-dark',
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: 'phone-light',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        colorScheme: 'light',
      },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false VITE_ENABLE_CHAT_SIDEBAR_SECTIONS=true VITE_ENABLE_CHANNEL_TAGS=true bunx vite --config src/features/channels-view/components/rail/next/browser-test/vite.config.ts --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('../../../../../../../', import.meta.url)),
    url: `http://127.0.0.1:${port}/src/features/channels-view/components/rail/next/browser-test/sidebar.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
