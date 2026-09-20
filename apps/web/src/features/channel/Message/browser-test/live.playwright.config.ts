import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PREVIEW_LOCAL_APP_URL ?? 'http://localhost:31009';
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) {
  throw new Error('Live preview verification only runs against a local stack');
}
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.live.e2e.ts',
  outputDir: '/tmp/rich-link-preview-live',
  timeout: 120_000,
  workers: 1,
  reporter: 'line',
  projects: [
    { name: 'desktop' },
    {
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        video: { mode: 'on', size: { width: 375, height: 812 } },
      },
    },
  ],
  use: {
    baseURL,
    channel: 'chrome',
    viewport: { width: 1280, height: 960 },
    video: { mode: 'on', size: { width: 1280, height: 960 } },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
