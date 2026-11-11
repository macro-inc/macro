import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [resolve(import.meta.dirname, 'utilities.test.ts')],
    environment: 'jsdom',
    maxWorkers: 1,
  },
});
