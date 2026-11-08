import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      'loro-crdt': resolve(
        import.meta.dirname,
        '../../node_modules/loro-crdt/nodejs/index.js'
      ),
    },
  },
  test: {
    name: 'session',
    environment: 'node',
    include: ['src/session/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
