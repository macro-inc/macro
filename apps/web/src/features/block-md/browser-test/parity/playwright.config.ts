import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const localHost = process.env.EDITOR_PARITY_LOCAL_HOST;

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.e2e.ts',
  workers: 1,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.EDITOR_PARITY_JSON_REPORT ?? 'parity-results.json',
      },
    ],
  ],
  snapshotPathTemplate: '{testDir}/.runtime-baselines/{arg}{ext}',
  timeout: 360_000,
  fullyParallel: false,
  use: {
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1100 },
    storageState: process.env.EDITOR_PARITY_AUTH,
    permissions: ['clipboard-read', 'clipboard-write'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        `--host-resolver-rules=${[localHost ? `MAP ${localHost} 127.0.0.1` : '', 'MAP *.localhost 127.0.0.1'].filter(Boolean).join(', ')}`,
      ],
    },
  },
});
