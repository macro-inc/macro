import solidPlugin from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin(), wasm()],
  resolve: {
    dedupe: ['@macro-inc/automerge', 'solid-js'],
    alias: {},
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/collab/**/*.{test,spec}.{ts,tsx}'],
    name: 'collaboration',
  },
} as any);
