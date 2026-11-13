import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const stub = (name: string) => `${directory}/stubs/${name}.ts`;

/**
 * Mounts the real Macro computers section over the real computers queries and
 * service client, so Playwright can answer `/team/computers/*` itself. Only
 * the app's shell (account, team, feature flags, other queries) is stubbed.
 */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    tailwindcss(),
    wasm(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      { find: '@queries/client', replacement: stub('query-client') },
      { find: '@queries/harnesses/harnesses', replacement: stub('harnesses') },
      { find: '@queries/team/teams', replacement: stub('teams') },
      { find: '@queries/agents/agents', replacement: stub('agents') },
      { find: '@queries/bots/bots', replacement: stub('bots') },
      { find: '@queries/computers/claude', replacement: stub('claude') },
      { find: '@app/lib/analytics/posthog', replacement: stub('posthog') },
      { find: '@core/context/user', replacement: stub('user-context') },
      { find: '@core/user', replacement: stub('user') },
      { find: '@core/constant/SettingsState', replacement: stub('settings') },
      {
        find: '@components/app/split-layout/layout',
        replacement: stub('split-layout'),
      },
      {
        find: '@app/features/agents-view/primitives/open-page',
        replacement: stub('open-page'),
      },
      {
        find: '@app/features/access-requests/access-requests',
        replacement: stub('access-requests'),
      },
    ],
  },
  // Same-origin service URLs, so the test's routes see `/auth/team/computers/*`.
  define: { 'import.meta.env.VITE_LOCAL_BACKEND_ORIGIN': '"same-origin"' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: { host: '127.0.0.1', strictPort: true },
});
