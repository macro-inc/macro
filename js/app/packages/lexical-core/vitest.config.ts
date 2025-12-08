import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../',
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
