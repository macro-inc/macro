import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../../../../', import.meta.url));

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${web}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: { dedupe: ['solid-js'] },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspace] },
  },
});
