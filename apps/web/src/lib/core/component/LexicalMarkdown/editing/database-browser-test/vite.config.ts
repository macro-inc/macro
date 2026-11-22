import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import svg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import paths from 'vite-tsconfig-paths';

const root = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../../../../', import.meta.url));
export default defineConfig({
  root,
  cacheDir: `${web}/node_modules/.vite-database-action`,
  define: {
    'import.meta.env.VITE_LOCAL_ONLY': JSON.stringify('true'),
    'import.meta.env.VITE_LOCAL_SERVERS': JSON.stringify('ALL'),
    'import.meta.env.VITE_LOCAL_BACKEND_ORIGIN': JSON.stringify('same-origin'),
  },
  plugins: [
    tailwind(),
    paths({ projects: [`${web}/tsconfig.json`] }),
    solid(),
    svg({ defaultAsComponent: true }),
    wasm(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      { find: '@queries/storage/databases', replacement: `${root}/service.ts` },
    ],
  },
  server: { host: '127.0.0.1', port: 43829, strictPort: true },
});
