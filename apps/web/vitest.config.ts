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
        extends: './src/lib/websocket/vitest.config.ts',
        test: {
          include: ['src/lib/websocket/**/*.test.{ts,tsx}'],
          name: 'websocket',
        },
      },
      {
        // Core package tests
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/lib/core/**/*.{test,spec}.{ts,tsx}'],
          name: 'core',
        },
      },
      {
        // Queries package tests
        extends: './src/lib/queries/vitest.config.ts',
        test: {
          include: ['src/lib/queries/**/*.{test,spec}.{ts,tsx}'],
          name: 'queries',
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          include: ['src/lib/graphql-cache/**/*.{test,spec}.{ts,tsx}'],
          name: 'graphql-cache',
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
          include: ['../../packages/lexical-core/**/*.{test,spec}.{ts,tsx}'],
          name: 'lexical-core',
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['src/features/theme/**/*.{test,spec}.{ts,tsx}'],
          name: 'theme',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-channel',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-call/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-call',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-pr/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-pr',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-md/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-md',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'channel',
        },
      },
      {
        extends: './src/features/notifications/vitest.config.ts',
        test: {
          include: ['src/features/notifications/**/*.{test,spec}.{ts,tsx}'],
          name: 'notifications',
        },
      },
      {
        test: {
          include: ['src/features/block-email/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-email',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/lib/service-clients/**/*.{test,spec}.{ts,tsx}'],
          name: 'service-clients',
        },
      },
    ],
  },
});
