import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@core': fileURLToPath(
        new URL('../../../apps/web/src/lib/core', import.meta.url)
      ),
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 3076),
    strictPort: true,
    fs: { allow: ['../..'] },
  },
});
