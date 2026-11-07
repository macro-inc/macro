import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    tailwindcss(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@service-storage/graphql-contacts': `${directory}/network.ts`,
      '@queries/contacts/use-directory': `${directory}/calendar-adapters.tsx`,
      '@core/component/UserIcon': `${directory}/calendar-adapters.tsx`,
      '@core/component/EntityIcon': `${directory}/calendar-adapters.tsx`,
      '@core/user/use-contact-filter-options': `${directory}/list-filter-adapters.tsx`,
      '@app/lib/analytics/posthog': `${directory}/list-filter-adapters.tsx`,
      '@property/tags/use-tag-filter-group': `${directory}/list-filter-adapters.tsx`,
      '../context/drive-context': `${directory}/list-filter-adapters.tsx`,
      '../email-view/filters/use-email-filters': `${directory}/list-filter-adapters.tsx`,
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: { host: '127.0.0.1', strictPort: true },
});
