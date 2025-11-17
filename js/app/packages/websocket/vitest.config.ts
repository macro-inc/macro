import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../',
    }),
  ],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],
  },
});
