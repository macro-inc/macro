import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  resolve: { alias: { 'loro-crdt': 'loro-crdt/base64' } },
  test: {
    environment: 'node',
    maxWorkers: 2,
    include: [
      'packages/spreadsheet/src/**/*.test.ts',
      'services/ai-editing-worker/src/spreadsheet/**/*.test.ts',
    ],
  },
});
