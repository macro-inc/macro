import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'editor-ops',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
