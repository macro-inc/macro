import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

const corpusDirectory = fileURLToPath(
  new URL('../../../../../../crates/pptx_engine/tests/corpus/', import.meta.url)
);

export default defineConfig({
  root: directory,
  // Corpus decks are served from outside the fixture root through `/@fs`.
  define: { __PPTX_CORPUS_URL__: JSON.stringify(`/@fs${corpusDirectory}`) },
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
    // Loro (collaboration) is a wasm singleton, as in the app's config.
    wasm(),
  ],
  resolve: { dedupe: ['solid-js', 'loro-crdt'] },
  optimizeDeps: {
    exclude: ['loro-crdt'],
    esbuildOptions: { target: 'esnext' },
  },
  server: {
    host: '127.0.0.1',
    port: 3018,
    strictPort: true,
    // The corpus decks and the wasm package live outside this directory.
    fs: { allow: [workspaceDirectory] },
  },
  worker: {
    format: 'es',
    plugins: () => [
      tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    ],
  },
  build: {
    target: 'esnext',
    outDir: `${directory}/.dist`,
    emptyOutDir: true,
  },
});
