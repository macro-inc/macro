import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [solid(), tsconfigPaths({ projects: [`${web}/tsconfig.json`] })],
  resolve: { dedupe: ['solid-js'] },
  server: { host: '127.0.0.1', strictPort: true },
});
