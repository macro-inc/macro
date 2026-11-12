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
const adapter = fileURLToPath(new URL('./title-adapters.tsx', import.meta.url));
const services = new Set([
  '@app/features/next-soup/actions',
  '@app/lib/analytics/posthog',
  '@components/app/GlobalAppState',
  '@core/component/FileList/useItemOperations',
  '@core/context/quickAccess',
  '@app/features/entity-appearance/entity-appearance',
]);

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite/title`,
  plugins: [
    {
      name: 'title-external-services',
      enforce: 'pre',
      resolveId(source, importer) {
        if (importer?.endsWith('/SplitFileMenu.tsx') && services.has(source))
          return adapter;
      },
    },
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@core/component/UserIcon': fileURLToPath(
        new URL('./user-icon.tsx', import.meta.url)
      ),
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
