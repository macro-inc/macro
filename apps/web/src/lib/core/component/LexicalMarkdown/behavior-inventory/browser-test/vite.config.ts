import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const PORT = Number(process.env.EDITOR_BEHAVIOR_PORT ?? 43183);

if (
  process.env.EDITOR_BEHAVIOR_ENGINE &&
  process.env.EDITOR_BEHAVIOR_ENGINE !== 'OFF'
) {
  throw new Error(
    'Production compat resolver is not available in this checkout; do not label an upstream fixture ON'
  );
}

export default defineConfig({
  root: DIRECTORY,
  cacheDir: `${WEB_DIRECTORY}/node_modules/.vite-editor-behavior`,
  plugins: [
    tailwind(),
    tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    wasm(),
  ],
  worker: {
    format: 'es',
    plugins: () => [
      tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
      wasm(),
    ],
  },
  resolve: { dedupe: ['solid-js'], alias: { 'loro-crdt': 'loro-crdt/base64' } },
  build: {
    outDir: `${WEB_DIRECTORY}/node_modules/.editor-behavior-dist`,
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: `${DIRECTORY}/index.html`,
        mentions: `${DIRECTORY}/mentions.html`,
        snippets: `${DIRECTORY}/snippets.html`,
      },
    },
  },
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
});
