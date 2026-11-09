import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: [fileURLToPath(new URL('./contract.test.ts', import.meta.url))],
    maxWorkers: 1,
  },
});
