import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: directory,
  base: '/app/',
  plugins: [
    tsconfigPaths({
      projects: [resolve(directory, '../../../../../tsconfig.json')],
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    outDir: resolve(directory, '.dist-benchmark'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { input: resolve(directory, 'graphql-queries.html') },
  },
});
