import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), solidPlugin()],
  test: {
    exclude: [...configDefaults.exclude],
    // Use projects to allow different configurations per package
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
        // Default app tests with browser environment
        test: {
          include: ['packages/app/**/*.test.{ts,tsx}'],
          name: 'app',
        },
      },
    ],
  },
});
