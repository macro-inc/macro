import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const storybookConfigDir = path.resolve(
  import.meta.dirname,
  'packages/ui/.storybook'
);

export default defineConfig({
  plugins: [tsconfigPaths(), solidPlugin()],
  test: {
    exclude: [...configDefaults.exclude],
    projects: [
      {
        // WebSocket tests with Node.js environment
        extends: './packages/websocket/vitest.config.ts',
        test: {
          include: ['packages/websocket/**/*.test.{ts,tsx}'],
          name: 'websocket',
        },
      },
      {
        // Core package tests
        extends: './packages/core/vitest.config.ts',
        test: {
          include: ['packages/core/**/*.{test,spec}.{ts,tsx}'],
          name: 'core',
        },
      },
      {
        // Queries package tests
        extends: './packages/queries/vitest.config.ts',
        test: {
          include: ['packages/queries/**/*.{test,spec}.{ts,tsx}'],
          name: 'queries',
        },
      },
      {
        // @ui package component tests
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
      },
    ],
  },
});
