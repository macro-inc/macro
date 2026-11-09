import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.e2e.ts',
  workers: 1,
  reporter: 'list',
  outputDir: join(tmpdir(), 'lexical-compat-dom-results'),
  use: { headless: true },
  projects: ['chromium', 'firefox', 'webkit'].map((browserName) => ({
    name: browserName,
    use: {
      browserName: browserName as 'chromium' | 'firefox' | 'webkit',
      launchOptions: {
        executablePath:
          process.env[
            `PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE_PATH`
          ],
      },
    },
  })),
  webServer: [
    {
      command:
        'COMPAT_BASELINE=upstream bunx vite build --config src/compat/browser/vite.config.ts && COMPAT_BASELINE=upstream bunx vite preview --config src/compat/browser/vite.config.ts',
      cwd: new URL('../../..', import.meta.url).pathname,
      url: 'http://127.0.0.1:41871',
      reuseExistingServer: false,
    },
    {
      command:
        'bunx vite build --config src/compat/browser/vite.config.ts && bunx vite preview --config src/compat/browser/vite.config.ts',
      cwd: new URL('../../..', import.meta.url).pathname,
      url: 'http://127.0.0.1:41872',
      reuseExistingServer: false,
    },
  ],
});
