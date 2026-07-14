import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/sync-service/**/*.{test,spec}.{ts,tsx}',
      'src/websocket/**/*.{test,spec}.{ts,tsx}',
    ],
    name: 'websocket',
    setupFiles: [resolve(import.meta.dirname, './vitest.setup.ts')],
  },
} as any);
