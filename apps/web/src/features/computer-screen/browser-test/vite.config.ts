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

/** Real screen and Claude access UI over scripted transports. */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@queries/computers/claude': `${directory}/claude-adapter.ts`,
      '@core/util/url': `${directory}/external-url.ts`,
    },
  },
  server: {
    host: '127.0.0.1',
    watch: null,
    port: 3109,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
