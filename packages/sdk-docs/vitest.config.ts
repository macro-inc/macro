import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    name: 'sdk-docs',
    environment: 'node',
    maxWorkers: 2,
    include: ['src/**/*.test.ts'],
  },
});
