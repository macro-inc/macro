import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    name: 'browser-store',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
