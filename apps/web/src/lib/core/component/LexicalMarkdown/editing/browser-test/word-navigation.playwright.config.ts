import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const output =
  process.env.NATIVE_WORD_OUTPUT ??
  join(tmpdir(), 'native-word-navigation-browser');
const port = Number(process.env.NATIVE_WORD_PORT ?? 43627);
export default defineConfig({
  ...base,
  testMatch: 'word-navigation.browser.e2e.ts',
  outputDir: join(output, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  projects: base.projects?.filter((project) =>
    project.name?.startsWith('chromium')
  ),
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...base.webServer,
    command:
      process.env.NATIVE_WORD_PREBUILT === 'true'
        ? 'bunx vite preview --config word-navigation.vite.config.ts'
        : 'bunx vite build --config word-navigation.vite.config.ts && bunx vite preview --config word-navigation.vite.config.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
