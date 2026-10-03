import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  plugins: [tsconfigPaths(), solidPlugin()],
  ssr: { resolve: { conditions: ['browser', 'development'] } },
  test: {
    name: 'scheduling',
    environment: 'jsdom',
    include: ['src/features/scheduling/**/*.{test,spec}.{ts,tsx}'],
  },
});
