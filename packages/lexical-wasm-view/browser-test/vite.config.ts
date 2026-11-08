import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({
  plugins: [solid()],
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 3076),
    strictPort: true,
    fs: { allow: ['../..'] },
  },
});
