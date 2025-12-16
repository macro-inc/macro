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
    ],
  },
});
