import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);

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
      {
        find: '@app/lib/analytics/posthog',
        replacement: `${directory}/flags.ts`,
      },
      {
        find: '@queries/harnesses/harnesses',
        replacement: `${directory}/scenario.ts`,
      },
      { find: '@queries/team-agents', replacement: `${directory}/scenario.ts` },
      {
        find: '@queries/access-requests/requests',
        replacement: `${directory}/scenario.ts`,
      },
      {
        find: /^\.\/queries\/novnc$/,
        replacement: `${directory}/transport.ts`,
      },
      {
        find: /^\.\/queries\/screen-url$/,
        replacement: `${directory}/transport.ts`,
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    watch: null,
    fs: { allow: [workspaceDirectory] },
  },
});
