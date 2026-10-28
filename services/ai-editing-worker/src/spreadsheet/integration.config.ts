import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['services/ai-editing-worker/src/spreadsheet/integration.e2e.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
