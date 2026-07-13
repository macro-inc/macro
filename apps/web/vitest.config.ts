import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@solid-primitives/refs': fileURLToPath(
        new URL(
          '../../node_modules/@solid-primitives/refs/dist/index.js',
          import.meta.url
        )
      ),
      '@solid-primitives/transition-group': fileURLToPath(
        new URL(
          '../../node_modules/@solid-primitives/transition-group/dist/index.js',
          import.meta.url
        )
      ),
    },
  },
  test: {
    exclude: [...configDefaults.exclude],
    projects: [
      '../../packages/collaboration/vitest.collab.config.ts',
      '../../packages/collaboration/vitest.transport.config.ts',
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
        // Resolve solid-js to its reactive browser build (the default
        // server-side build is inert), needed by the solid/ bindings.
        plugins: [tsconfigPaths(), solidPlugin()],
        ssr: {
          resolve: {
            conditions: ['browser', 'development'],
          },
        },
        test: {
          environment: 'jsdom',
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
      {
        // App-shell and feature tests without a specialized environment.
        extends: './src/lib/core/vitest.config.ts',
        test: {
          environment: 'jsdom',
          exclude: [
            ...configDefaults.exclude,
            'src/features/{theme,block-channel,block-call,block-pr,block-md,channel,notifications,block-email}/**/*',
          ],
          include: [
            'src/components/**/*.{test,spec}.{ts,tsx}',
            'src/features/**/*.{test,spec}.{ts,tsx}',
            'src/routes/**/*.{test,spec}.{ts,tsx}',
          ],
          name: 'app',
        },
      },
    ],
  },
});
