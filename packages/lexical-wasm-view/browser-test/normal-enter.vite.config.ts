import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from './vite.config';
export default mergeConfig(base, {
  build: {
    target: 'esnext',
    outDir: process.env.NATIVE_ENTER_DIST ?? 'dist/normal-enter',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./normal-enter.html', import.meta.url)),
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 40731),
    strictPort: true,
  },
});
