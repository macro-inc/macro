import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/export-surface/surface.test.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
});
