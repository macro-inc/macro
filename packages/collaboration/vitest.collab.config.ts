import solidPlugin from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin(), wasm()],
  resolve: {
    dedupe: ['loro-crdt', 'solid-js'],
    alias: {
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/collab/**/*.{test,spec}.{ts,tsx}'],
    name: 'collaboration',
  },
} as any);
