import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const manifest = readFileSync(new URL('./wasm/manifest.json', import.meta.url));
if (
  createHash('sha256').update(manifest).digest('hex') !==
  '62ff004f03c782064788516fa5fa51242197ce3eded7847383b9e83705754d7d'
)
  throw new Error('Unqualified image artifact manifest');
const expected = {
  'document_session_wasm.js':
    '766d9a3aa8e9b1c4514a73fa271dac6a548c81d91881e167f6648d4063f063de',
  'document_session_wasm_bg.wasm':
    'a27580b61deb04a44a018f21e07cde4ba293ab07b339d0cf2af3343ef78ae2b2',
  'document_session_wasm.d.ts':
    'c4fa70d3f51704f33d23ced204129acd8a485864eac514d8e376cbcdabe384c1',
  'document_session_wasm_bg.wasm.d.ts':
    '6627741b57cd3137378f232bf98d7c023206ee075612284e7ee1f3dfecaf9d24',
  'package.json':
    'af2c9938e67104d499b97c8f8225e52fcd2f2b0a0212e7a154ed16ba048dd0a5',
};
for (const [name, sha] of Object.entries(expected)) {
  if (
    createHash('sha256')
      .update(readFileSync(new URL(`./wasm/${name}`, import.meta.url)))
      .digest('hex') !== sha
  )
    throw new Error(`Unqualified image artifact: ${name}`);
}
const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir: process.env.IMAGE_TEST_OUTPUT ?? 'test-results/image',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: process.env.IMAGE_TEST_REPORT ?? 'test-results/image.json',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:40617',
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
    command:
      'MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port 40617 --strictPort',
    cwd: webDirectory,
    url: 'http://127.0.0.1:40617/app/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
