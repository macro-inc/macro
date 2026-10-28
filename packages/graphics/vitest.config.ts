import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solid()],
  resolve: {
    dedupe: ['solid-js'],
    conditions: ['browser', 'development'],
    alias: { 'loro-crdt': 'loro-crdt/nodejs' },
  },
  test: {
    name: 'graphics',
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
