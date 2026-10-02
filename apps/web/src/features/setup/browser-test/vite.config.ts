import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const mocks = fileURLToPath(new URL('./mocks.ts', import.meta.url));
const replaced = [
  '@app/lib/analytics/analytics-context',
  '@core/context/user',
  '@core/email-link',
  '@core/component/Toast/Toast',
  '@queries/auth',
  '@queries/auth/keys',
  '@queries/auth/tutorial',
  '@queries/auth/user-info',
  '@queries/client',
  '@queries/email/link',
  '@queries/import',
  '@queries/mcp-servers',
  '@queries/onboarding',
  '@queries/pipedream-connectors',
  '@queries/contacts/contacts',
  '@queries/team/invitations',
  '@queries/team/teams',
  '@solidjs/router',
];
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
    alias: replaced.map((find) => ({
      find: new RegExp(`^${find}$`),
      replacement: mocks,
    })),
  },
  server: {
    host: '127.0.0.1',
    port: 3005,
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL('../../../../../../', import.meta.url))],
    },
  },
});
