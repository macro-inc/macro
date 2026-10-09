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

// `.psd` files `?file=` opens: any directory of local files (PSD_CORPUS_DIR,
// with a trailing slash). No Photoshop files are committed.
const corpusDirectory = process.env.PSD_CORPUS_DIR ?? '';

export default defineConfig({
  root: directory,
  define: {
    __PSD_CORPUS_URL__: JSON.stringify(
      corpusDirectory ? `/@fs${corpusDirectory}` : ''
    ),
  },
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
    port: Number(process.env.PSD_BROWSER_PORT ?? 3020),
    strictPort: true,
    // The wasm package and any local corpus live outside this directory.
    fs: {
      allow: corpusDirectory
        ? [workspaceDirectory, corpusDirectory]
        : [workspaceDirectory],
    },
  },
  worker: {
    format: 'es',
    plugins: () => [
      tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    ],
  },
});
