import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { docxodusRuntime } from '../../../../scripts/docxodus-runtime';

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
    wasm(),
    docxodusRuntime(),
  ],
  resolve: { dedupe: ['solid-js', 'loro-crdt'] },
  optimizeDeps: { include: ['fflate', 'docxodus'], exclude: ['loro-crdt'] },
  server: {
    host: '127.0.0.1',
    port: 3018,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
  build: { target: 'esnext', outDir: `${directory}/.dist`, emptyOutDir: true },
});
