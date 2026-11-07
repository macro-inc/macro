import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['record/__tests__/*.test.ts'], environment: 'node', maxWorkers: 1,
} });
