import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const hashes = {
  'document_session_wasm_bg.wasm':
    '72825c5c69ad6c12ace35d1ee5214795b894d3390ed76ac9d59bad9fb6796ed9',
  'document_session_wasm.js':
    '0be024e8ccc7a59e48bf59a4b9dd4d15eb98853bffea9a80eb794084bd9e0f07',
  'document_session_wasm.d.ts':
    'bc00fbcc5932470a421899fbfb4b57ddf78316433df71158f509c0b12df4c577',
  'document_session_wasm_bg.wasm.d.ts':
    'befe55387d4dfe18b1980f9190cfa4116afe1f33dd07a0c2d415e1f0f9922a08',
  'package.json':
    'af2c9938e67104d499b97c8f8225e52fcd2f2b0a0212e7a154ed16ba048dd0a5',
};
for (const [name, hash] of Object.entries(hashes)) {
  if (
    createHash('sha256')
      .update(readFileSync(new URL(`./wasm/${name}`, import.meta.url)))
      .digest('hex') !== hash
  )
    throw new Error(`Unqualified user mention artifact: ${name}`);
}
const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const port = process.env.USER_MENTION_PORT ?? '40767';

export default defineConfig({
  testDir: '.',
  testMatch: 'mention.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir: process.env.USER_MENTION_OUTPUT ?? 'test-results/decorator-host',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.USER_MENTION_REPORT ?? 'test-results/decorator-host.json',
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
