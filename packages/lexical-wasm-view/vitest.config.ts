import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node', maxWorkers: 1 },
});
