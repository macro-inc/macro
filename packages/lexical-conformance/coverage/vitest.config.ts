import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['coverage/__tests__/*.test.ts'], maxWorkers: 2 },
});
