import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
