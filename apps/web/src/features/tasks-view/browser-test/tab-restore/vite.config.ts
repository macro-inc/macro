import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const adapters = `${directory}adapters.tsx`;
const environmentImports = new Set([
  '@app/features/soup',
  '@app/features/next-soup/filters',
  '@app/components/view-shell',
  '@app/lib/analytics/posthog',
  '@app/features/soup/assignee-picker',
  '@core/context/user',
  '@core/component/UserIcon',
  '@core/user/use-contact-filter-options',
  '@core/constant/allBlocks',
  '@components/app/createPreviewSelectionGuard',
  '@property/tags/tag-sets-context',
  '@property/tags/use-tag-filter-group',
  '@property/component/propertyValue',
  '@queries/auth/use-query-account',
  '@components/app/GlobalAppState',
  '@components/app/split-layout/layoutUtils',
  '@notifications/mark-row-seen',
  '@entity',
]);

export default defineConfig({
  root: directory,
  cacheDir: `${directory}.vite`,
  plugins: [
    {
      name: 'tasks-tab-environment',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          environmentImports.has(source) ||
          (importer?.endsWith('/view-restoration.ts') &&
            source === './layoutUtils')
        )
          return adapters;
        if (
          source === '@app/routes/routes' ||
          (importer?.endsWith('/view-restoration.ts') &&
            source === './split-router/legacy-route')
        )
          return `${directory}routes.ts`;
        if (
          importer?.endsWith('/split-layout/layoutManager.ts') &&
          source === './componentRegistry'
        )
          return adapters;
        if (importer?.includes('/tasks-view/')) {
          if (
            source.endsWith('/queries/use-tasks-query') ||
            source.endsWith('/queries/ai-task-filter-plan') ||
            source.endsWith('/views/task-saved-views')
          )
            return adapters;
        }
      },
    },
    tailwindcss(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  build: {
    outDir: `${webDirectory}node_modules/.cache/tasks-tab-restore`,
    emptyOutDir: true,
  },
  server: { host: '127.0.0.1', strictPort: true },
});
