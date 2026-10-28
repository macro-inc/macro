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

// `.ai` files `?file=` opens: any directory of local files (AI_CORPUS_DIR,
// with a trailing slash). Without one, the tests build their documents.
const corpusDirectory = process.env.AI_CORPUS_DIR ?? directory;

const interUrl = `/@fs${workspaceDirectory}crates/fig_engine/fonts/InterVariable.ttf`;

export default defineConfig({
  root: directory,
  define: {
    __AI_CORPUS_URL__: JSON.stringify(`/@fs${corpusDirectory}`),
    // The font the stand-in font source serves (the Figma fixture's).
    __FIG_FONT_URL__: JSON.stringify(interUrl),
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
    port: Number(process.env.AI_BROWSER_PORT ?? 3021),
    strictPort: true,
    // The corpus and the wasm package live outside this directory.
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
