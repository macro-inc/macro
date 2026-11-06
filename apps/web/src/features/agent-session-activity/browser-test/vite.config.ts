import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
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
    alias: [
      { find: '@app/lib/i18n', replacement: `${directory}/mock-i18n.ts` },
      {
        find: '@components/app/side-panel',
        replacement: `${directory}/mock-ui.tsx`,
      },
      { find: '@property/hooks', replacement: `${directory}/mock-ui.tsx` },
      {
        find: '@app/features/activity/components/entity-mention',
        replacement: `${directory}/mock-ui.tsx`,
      },
      {
        find: '@app/features/activity/context/activity-context',
        replacement: `${directory}/mock-ui.tsx`,
      },
      {
        find: '@core/component/EntityIcon',
        replacement: `${directory}/mock-ui.tsx`,
      },
      { find: '@ui', replacement: `${directory}/mock-ui.tsx` },
    ],
  },
  server: { host: '127.0.0.1', strictPort: true },
});
