import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: resolve(process.env.TMPDIR ?? '/tmp', 'compat-measurement-vite'),
  test: {
    include: [resolve(import.meta.dirname, '*.test.ts')],
    environment: 'node',
    maxWorkers: 1,
  },
});
