import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: directory,
  plugins: [
    solid(),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@components/app/GlobalAppState': `${directory}/source.ts`,
      '@notifications/notification-helpers': `${directory}/source.ts`,
      '@core/component/CustomScrollbar': `${directory}/scrollbar.tsx`,
    },
  },
  server: { host: '127.0.0.1', strictPort: true },
});
