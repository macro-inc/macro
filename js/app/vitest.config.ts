import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

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
        // @ui package Storybook component tests
        extends: './packages/ui/.storybook/vitest.config.ts',
        test: {
          name: 'storybook',
        },
      },
      {
        test: {
          include: ['scripts/**/*.{test,spec}.{ts,tsx}'],
          name: 'scripts',
        },
      },
      {
        extends: './packages/lexical-core/vitest.config.ts',
        test: {
          include: ['packages/lexical-core/**/*.{test,spec}.{ts,tsx}'],
          name: 'lexical-core',
        },
      },
      {
        extends: './packages/core/vitest.config.ts',
        test: {
          include: ['packages/block-channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-channel',
        },
      },
      {
        extends: './packages/notifications/vitest.config.ts',
        test: {
          include: ['packages/notifications/**/*.{test,spec}.{ts,tsx}'],
          name: 'notifications',
        },
      },
    ],
  },
});
