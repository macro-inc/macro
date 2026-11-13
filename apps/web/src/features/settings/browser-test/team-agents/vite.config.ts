import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspace = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);

/** Team › Members over a scripted auth service (see the spec's routes). */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${web}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: { 'loro-crdt': 'loro-crdt/base64' },
  },
  // Claude sign-in for an agent's computer sits behind the computers rollout.
  define: { 'import.meta.env.VITE_ENABLE_MACRO_COMPUTERS': '"true"' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: {
    host: '127.0.0.1',
    port: 3109,
    strictPort: true,
    fs: { allow: [workspace] },
  },
});
