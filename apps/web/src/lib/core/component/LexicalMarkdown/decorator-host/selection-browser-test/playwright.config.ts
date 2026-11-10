/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// This fixture is qualified only for the sealed native component artifact.
const artifactHashes = {
  'document_session_wasm.js':
    'f11205af185b86acae361721b8d4f1d70e81b325e8e1f0e1b0cea024a3ce00f7',
  'document_session_wasm_bg.wasm':
    '6dca1f84b0b20bf30472befe0a7765f401120de61b85f7deb84f941f38134c8a',
  'document_session_wasm.d.ts':
    '01b749595faf5ec15be94281e24a8057827c29b2f454a071e81176529a63c46c',
  'document_session_wasm_bg.wasm.d.ts':
    'ec458e74f2cf76bf34d4c48fa9d9e3e7217907fde5408d4aff8682aaccbe255a',
  'package.json':
    'af2c9938e67104d499b97c8f8225e52fcd2f2b0a0212e7a154ed16ba048dd0a5',
};
for (const [name, expected] of Object.entries(artifactHashes)) {
  const actual = createHash('sha256')
    .update(readFileSync(new URL(`./wasm/${name}`, import.meta.url)))
    .digest('hex');
  if (actual !== expected)
    throw new Error(`Unqualified selection fixture artifact: ${name}`);
}

const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const port = process.env.FAST_DECORATOR_TEST_PORT ?? '40539';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir:
    process.env.FAST_DECORATOR_TEST_OUTPUT ?? 'test-results/fast-decorators',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.FAST_DECORATOR_TEST_REPORT ??
          'test-results/fast-decorators.json',
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1000, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
        },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,
        },
      },
    },
  ],
  webServer: {
    command: `MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: webDirectory,
    url: `http://127.0.0.1:${port}/app/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
