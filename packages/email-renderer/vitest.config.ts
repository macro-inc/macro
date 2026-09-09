import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'email-renderer',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/*.test.ts'],
  },
});
