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
        test: {
          include: ['scripts/**/*.{test,spec}.{ts,tsx}'],
          name: 'scripts',
        },
      },
      {
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['../lexical-core/**/*.{test,spec}.{ts,tsx}'],
          name: 'lexical-core',
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['packages/theme/**/*.{test,spec}.{ts,tsx}'],
          name: 'theme',
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
        extends: './packages/core/vitest.config.ts',
        test: {
          include: ['packages/block-call/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-call',
        },
      },
      {
        extends: './packages/core/vitest.config.ts',
        test: {
          include: ['packages/channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'channel',
        },
      },
      {
        extends: './packages/notifications/vitest.config.ts',
        test: {
          include: ['packages/notifications/**/*.{test,spec}.{ts,tsx}'],
          name: 'notifications',
        },
      },
      {
        test: {
          include: ['packages/block-email/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-email',
        },
      },
    ],
  },
});
