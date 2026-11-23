import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite/permissions`,
  plugins: [
    tailwindcss(),
    wasm(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js', 'loro-crdt'],
    alias: [
      // Every block-agent module reads the fixture's session.
      {
        find: /^(\.\.\/)+context\/AgentSessionContext$/,
        replacement: `${directory}/permissions-session.ts`,
      },
      // Links to the permissions page record where they went.
      {
        find: '@core/constant/SettingsState',
        replacement: `${directory}/permissions-settings.ts`,
      },
    ],
  },
  optimizeDeps: {
    entries: ['permissions.html'],
    exclude: ['loro-crdt'],
    rolldownOptions: { transform: { target: 'esnext' } },
  },
  server: { host: '127.0.0.1', strictPort: true },
});
