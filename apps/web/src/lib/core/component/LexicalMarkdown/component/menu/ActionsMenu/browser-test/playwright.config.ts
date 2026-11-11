import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const webDirectory = fileURLToPath(
  new URL('../../../../../../../../../', import.meta.url)
);
const port = process.env.ACTIONS_MENU_TEST_PORT ?? '3049';
const fixtureConfig =
  'src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/vite.config.ts';
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    command: process.env.ACTIONS_MENU_TEST_BUNDLE_DIR
      ? `MACRO_DEV_HTTPS=false bunx vite preview --config ${fixtureConfig} --port ${port} --strictPort`
      : `MACRO_DEV_HTTPS=false bunx vite --port ${port} --strictPort`,
    cwd: webDirectory,
    url: process.env.ACTIONS_MENU_TEST_BUNDLE_DIR
      ? `http://127.0.0.1:${port}/src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/control.html`
      : `http://127.0.0.1:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
