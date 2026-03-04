import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Vitest config that runs the websocket test suite with TauriWebSocketWrapper
 * instead of the native browser WebSocket.
 *
 * Run with:
 *   vitest --config vitest.tauri.config.ts
 */
export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../',
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/websocket.test.ts'],
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],
    env: {
      USE_TAURI_FACTORY: '1',
    },
  },
} as any);
