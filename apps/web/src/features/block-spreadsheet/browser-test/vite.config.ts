import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js', 'loro-crdt'],
    alias: { 'loro-crdt': 'loro-crdt/base64' },
  },
  // Worker-only lazy dependencies otherwise trigger a page reload on the first
  // import, discarding the file chooser's pending request in a cold test run.
  optimizeDeps: { include: ['@ironcalc/wasm', 'exceljs', 'fflate', 'saxes'] },
  server: {
    host: '127.0.0.1',
    port: 3017,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    outDir: `${directory}/.dist`,
    emptyOutDir: true,
  },
});
