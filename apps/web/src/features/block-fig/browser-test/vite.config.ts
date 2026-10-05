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

// `.fig` files to open: the engine's committed fixtures by default, or any
// directory of local files (FIG_CORPUS_DIR) for manual testing.
const corpusDirectory =
  process.env.FIG_CORPUS_DIR ??
  fileURLToPath(
    new URL(
      '../../../../../../crates/fig_engine/tests/fixtures/',
      import.meta.url
    )
  );

export default defineConfig({
  root: directory,
  define: { __FIG_CORPUS_URL__: JSON.stringify(`/@fs${corpusDirectory}`) },
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
    port: Number(process.env.FIG_BROWSER_PORT ?? 3019),
    strictPort: true,
    // The fixtures and the wasm package live outside this directory.
    fs: { allow: [workspaceDirectory, corpusDirectory] },
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
