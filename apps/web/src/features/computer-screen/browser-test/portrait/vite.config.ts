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
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      {
        find: /^@core\/context\/(?:channels|user)$/,
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@app/lib/analytics/posthog',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@queries/harnesses/harnesses',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@queries/team-agents',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@queries/agents/agents',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@queries/access-requests/requests',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: /^@core\/user(?:\/macroId)?$/,
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@core/signal/profilePicture',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@core/util/open-direct-message',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@core/constant/SettingsState',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@app/features/runtime-sharing/views/AgentRuntime',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: '@app/features/runtime-sharing/views/UserRuntimes',
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: /^\.\/userCardActions$/,
        replacement: `${directory}/scenario.tsx`,
      },
      {
        find: /^\.\/queries\/novnc$/,
        replacement: `${directory}/transport.ts`,
      },
      {
        find: /^@app\/lib\/service-clients\/service-agent-harness\/screen-url$/,
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
