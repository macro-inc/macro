import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(base, {
  build: {
    target: 'esnext',
    outDir: process.env.EDITOR_INPUT_PARITY_DIST ?? 'dist/input-parity',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        rendering: fileURLToPath(new URL('./index.html', import.meta.url)),
        heading: fileURLToPath(
          new URL('./heading-enter.html', import.meta.url)
        ),
        paste: fileURLToPath(new URL('./large-paste.html', import.meta.url)),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.LEXICAL_WASM_VIEW_TEST_PORT ?? 3197),
    strictPort: true,
  },
});
