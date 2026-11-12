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

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    {
      name: 'project-saved-view-transport',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/saved-view-actions'))
          return fileURLToPath(
            new URL('./saved-view-transport.ts', import.meta.url)
          );
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
      '@property/editors/selectors/PropertyEntitySelector': fileURLToPath(
        new URL('./picker-data.tsx', import.meta.url)
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
