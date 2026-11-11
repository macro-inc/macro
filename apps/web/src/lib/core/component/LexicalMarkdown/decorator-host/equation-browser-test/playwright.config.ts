import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const manifest = readFileSync(new URL('./wasm/manifest.json', import.meta.url));
if (
  createHash('sha256').update(manifest).digest('hex') !==
  '6fb082ba5d957673ca28ef1fa713dca658eb0ec67f579925b3d347f0ce9349b2'
)
  throw new Error('Unqualified 369f artifact manifest');
const expected = {
  'document_session_wasm.js':
    '02b30df1ed7be2db3bee243f3bd8cbcc07bd449f90abed04cb97ba386477b25d',
  'document_session_wasm_bg.wasm':
    'df414d91c88a858e2d19ce4ebb65db939a86eff4c4dd5fb4bb395abdf4cb1926',
  'document_session_wasm.d.ts':
    '31a0e9a1ad46ce7626d37993210ff49c264a485f7cb464e50f3f4d0b478c0a66',
  'document_session_wasm_bg.wasm.d.ts':
    'c6918e5e387a65ff278b6ecf1972db2026b486efef0fee711a20d918c5ce2dfc',
  'package.json':
    'af2c9938e67104d499b97c8f8225e52fcd2f2b0a0212e7a154ed16ba048dd0a5',
};
for (const [name, sha] of Object.entries(expected)) {
  if (
    createHash('sha256')
      .update(readFileSync(new URL(`./wasm/${name}`, import.meta.url)))
      .digest('hex') !== sha
  )
    throw new Error(`Unqualified equation artifact: ${name}`);
}
const webDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.e2e.ts',
  workers: 1,
  timeout: 90_000,
  outputDir: process.env.EQUATION_TEST_OUTPUT ?? 'test-results/equation',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.EQUATION_TEST_REPORT ?? 'test-results/equation.json',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:40619',
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
      'MACRO_DEV_HTTPS=false bunx vite --host 127.0.0.1 --port 40619 --strictPort',
    cwd: webDirectory,
    url: 'http://127.0.0.1:40619/app/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
