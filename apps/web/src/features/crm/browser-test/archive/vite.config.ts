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
        find: /^@components\/app\/side-panel$/,
        replacement: `${webDirectory}/src/components/app/side-panel/SidePanel.tsx`,
      },
      {
        find: /^@core\/constant\/allBlocks$/,
        replacement: `${directory}/host-preview.tsx`,
      },
      { find: /^@core\/block$/, replacement: `${directory}/host-preview.tsx` },
      {
        find: /^.*split-layout\/layoutUtils$/,
        replacement: `${directory}/host-preview.tsx`,
      },
      {
        find: /^.*split-layout\/components\/SplitHeader$/,
        replacement: `${directory}/host-preview.tsx`,
      },
      {
        find: /^@core\/hotkey\/hotkeys$/,
        replacement: `${directory}/host-preview.tsx`,
      },
      {
        find: /^@entity\/owner\/owner-display$/,
        replacement: `${directory}/host-preview.tsx`,
      },
      ...[
        '@service-storage/client',
        '@service-storage/crm-contacts',
        '@service-storage/crm-visibility',
        '@service-storage/crm-contact-edit',
        '@app/lib/analytics',
        '@app/lib/analytics/posthog',
        '@app/features/next-soup/filters/filter-store',
        '../context/crm-context',
      ].map((find) => ({
        find: new RegExp(`^${find}$`),
        replacement: `${directory}/preview-adapters.ts`,
      })),
      ...[
        '@core/context/quickAccess',
        '@core/context/user',
        '@core/user',
        '@queries/soup/search',
        '@core/component/UserIcon',
      ].map((find) => ({
        find: new RegExp(`^${find}$`),
        replacement: `${directory}/picker-preview.tsx`,
      })),
      { find: /^@entity$/, replacement: `${directory}/entity-preview.tsx` },
      {
        find: /^@app\/components\/view-shell$/,
        replacement: `${webDirectory}/src/components/view-shell/SearchBar.tsx`,
      },
    ],
  },
  worker: { format: 'es' },
  build: { target: 'esnext' },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
