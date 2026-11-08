import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths(),
    tailwind(),
    wasm(),
  ],
  resolve: { dedupe: ['solid-js', 'loro-crdt'] },
  build: {
    target: 'esnext',
    outDir: 'node_modules/.cache/call-playback-browser',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('src/features/block-call/browser-test/playback.html'),
    },
  },
  worker: { format: 'es' },
});
