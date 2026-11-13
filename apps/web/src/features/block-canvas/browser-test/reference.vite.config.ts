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

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
    wasm(),
  ],
  resolve: {
    alias: {
      '@core/component/DocumentPreview': `${directory}/document-preview.tsx`,
    },
    dedupe: ['solid-js', 'loro-crdt'],
  },
  optimizeDeps: {
    exclude: ['loro-crdt'],
    rolldownOptions: { transform: { target: 'esnext' } },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CANVAS_REFERENCE_PORT ?? 3029),
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
