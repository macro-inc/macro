import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [resolve(import.meta.dirname, 'configured-registry.test.ts')],
    environment: 'node',
    maxWorkers: 1,
  },
});
