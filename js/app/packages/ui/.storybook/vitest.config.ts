import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig } from 'vitest/config';

const storybookConfigDir = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: storybookConfigDir,
    }),
  ],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: [path.join(storybookConfigDir, 'vitest.setup.ts')],
  },
});
