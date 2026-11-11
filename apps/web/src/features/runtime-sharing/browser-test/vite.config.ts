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
const adapters = `${directory}preview-adapters.tsx`;

/**
 * The real Share menu, Pending requests and Teammates' runtimes sections, their queries and
 * service client, over a scripted network. Only the signed-in viewer, their
 * team, and how names render are stand-ins.
 */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      { find: '@queries/team/teams', replacement: adapters },
      { find: '@core/context/user', replacement: adapters },
      { find: '@entity/owner/owner-display', replacement: adapters },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 3097,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
