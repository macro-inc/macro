import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({
  plugins: [solid()],
  cacheDir: process.env.LEXICAL_WASM_VIEW_TEST_CACHE_DIR,
  resolve: {
    alias: {
      '@core': fileURLToPath(
        new URL('../../../apps/web/src/lib/core', import.meta.url)
      ),
    },
  },
  optimizeDeps: {
    include: ['@solid-primitives/scheduled'],
    esbuildOptions: { target: 'esnext' },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 3076),
    strictPort: true,
    fs: { allow: ['../..'] },
  },
});
