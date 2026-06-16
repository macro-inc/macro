import solidPlugin from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../',
    }),
    solidPlugin(),
    wasm(),
  ],
  resolve: {
    alias: {
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
