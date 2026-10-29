import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: DIRECTORY,
  cacheDir: `${DIRECTORY}/.vite`,
  plugins: [
    solid(),
    tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  server: { host: '127.0.0.1', strictPort: true },
});
