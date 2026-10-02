import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: directory,
  plugins: [
    solid(),
    tsconfigPaths({
      projects: [resolve(directory, '../../../../../tsconfig.json')],
    }),
  ],
  resolve: { dedupe: ['solid-js'] },
  define: { __CACHE_WASM_BUILD_MODE__: JSON.stringify('development') },
  server: { host: '127.0.0.1', port: 4196, strictPort: true },
  worker: { format: 'es' },
});
