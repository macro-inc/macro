import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);

// Keep the real workspace and shell; replace unrelated record/data surfaces.
function workspaceStandIns(): Plugin {
  return {
    name: 'member-access-workspace-stand-ins',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        source.endsWith('componentRegistry') ||
        source.endsWith('internal/BlockLoader') ||
        source.endsWith('internal/BlockEffectRunner')
      ) {
        return `${directory}/../privacy/navigation-stand-ins.tsx`;
      }
      if (
        importer?.endsWith('/crm/views/crm-workspace.tsx') &&
        [
          './activity',
          './crm-settings',
          './export-companies',
          './import-companies',
          './item-detail',
          './record-detail',
          './saved-views-menu',
        ].includes(source)
      )
        return `${directory}/workspace-adapters.tsx`;
      if (importer?.includes('/crm/') && source === './use-crm')
        return `${directory}/workspace-adapters.tsx`;
    },
  };
}

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    workspaceStandIns(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      ...[
        '@queries/team/teams',
        '@core/context/user',
        '@core/component/Toast/Toast',
        '@service-storage/crm-email-privacy',
      ].map((find) => ({
        find,
        replacement: `${directory}/../privacy/preview-adapters.ts`,
      })),
      ...[
        '../context/crm-context',
        '../context/workspace-context',
        '@app/features/connector-import/connector-import',
        '@app/features/next-soup/soup-view/filters-bar/mobile-filter-drawer',
        '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar',
        '@app/features/next-soup/soup-view/filters-bar/soup-filters-bar',
        '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group',
        '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort',
        '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown',
        '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements',
      ].map((find) => ({
        find,
        replacement: `${directory}/workspace-adapters.tsx`,
      })),
      {
        find: '@app/features/routine-suggestions/routine-suggestions',
        replacement: `${directory}/preview-adapters.ts`,
      },
      {
        find: '@app/lib/analytics/posthog',
        replacement: `${directory}/preview-adapters.ts`,
      },
    ],
  },
  optimizeDeps: { rolldownOptions: { transform: { target: 'esnext' } } },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
