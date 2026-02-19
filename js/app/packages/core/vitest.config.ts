import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../',
    }),
    solidPlugin(),
    wasm(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
