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
    {
      name: 'soup-filter-test-adapters',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          importer?.endsWith('/service-auth/client.ts') &&
          source === '@core/constant/servers'
        )
          return `${directory}/name-cache-services.ts`;
        if (importer?.includes('/integrations/import-linear/')) {
          if (
            [
              '@queries/auth/account-scope',
              '@queries/auth/use-query-account',
            ].includes(source)
          )
            return `${directory}/task-filter-adapters.tsx`;
          if (
            [
              '@core/util/create',
              '@queries/client',
              '@queries/history/history',
              '@core/component/Toast/Toast',
            ].includes(source)
          )
            return `${directory}/linear-import-adapters.ts`;
        }
        if (
          importer?.endsWith('/onboarding/queries/team-contacts.ts') &&
          [
            '@queries/auth/account-scope',
            '@queries/auth/use-query-account',
          ].includes(source)
        )
          return `${directory}/task-filter-adapters.tsx`;
        if (
          importer?.endsWith('/task-list/TaskListControls.tsx') &&
          [
            '@queries/soup/items',
            '../../plugins/checklist-controls/checklistControlsPlugin',
          ].includes(source)
        )
          return `${directory}/task-filter-adapters.tsx`;
        if (importer?.includes('/tasks-view/')) {
          if (
            source === '../tasks-view-context' ||
            source === '../views/task-saved-views'
          )
            return `${directory}/task-filter-adapters.tsx`;
          if (
            importer.endsWith('/queries/ai-task-filter-plan.ts') &&
            [
              '@queries/auth/account-scope',
              '@queries/auth/use-query-account',
              '@service-cognition/client',
            ].includes(source)
          )
            return `${directory}/task-filter-adapters.tsx`;
        }
        if (
          importer?.endsWith(
            '/property/editors/selectors/PropertyEntitySelector.tsx'
          )
        ) {
          if (['@entity', '@queries/soup/search'].includes(source))
            return `${directory}/property-user-adapters.tsx`;
          if (source === '@property/utils')
            return `${webDirectory}/src/features/property/utils/focus.ts`;
        }
        if (
          importer?.endsWith('/property/editors/selectors/entityUtils.ts') &&
          source === '@core/context/quickAccess'
        )
          return `${webDirectory}/src/lib/core/context/quickAccess/context.ts`;
        if (
          importer?.endsWith('/crm/filter-adapter.tsx') &&
          [
            '@app/preferences/make-flagged-persisted',
            '@components/app/split-layout/entry-state',
            '@core/user/util',
          ].includes(source)
        )
          return `${directory}/soup-filter-adapters.tsx`;
        if (
          importer?.endsWith('/queries/contacts/use-directory.ts') &&
          [
            '../auth/use-query-account',
            '@service-storage/graphql-soup',
          ].includes(source)
        )
          return `${directory}/calendar-adapters.tsx`;
        if (
          importer?.includes('/next-soup/filters/') ||
          importer?.endsWith('/crm/collection-filters.ts')
        ) {
          if (source === '@entity')
            return `${directory}/filter-entity-adapters.ts`;
          if (source === '@notifications')
            return `${webDirectory}/src/features/notifications/types.ts`;
        }
        if (
          importer?.includes('/next-soup/soup-view/filters-bar/') &&
          [
            '@app/features/next-soup/soup-view/soup-view-context',
            '@components/app/split-layout/layoutUtils',
            '@queries/auth',
            '@core/email-link',
            './tag-filter',
            './inbox-picker',
          ].includes(source)
        )
          return `${directory}/soup-filter-adapters.tsx`;
      },
    },
    tailwindcss(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      {
        find: /^@core\/user$/,
        replacement: `${directory}/calendar-adapters.tsx`,
      },
      ...Object.entries({
        '@service-storage/graphql-contacts': `${directory}/network.ts`,
        '@queries/auth/use-query-account': `${directory}/calendar-adapters.tsx`,
        '@queries/contacts/use-directory': `${directory}/calendar-adapters.tsx`,
        '@core/component/UserIcon': `${directory}/calendar-adapters.tsx`,
        '@core/component/UserTooltip': `${directory}/calendar-adapters.tsx`,
        '@core/component/Toast/Toast': `${directory}/calendar-adapters.tsx`,
        '@core/context/user': `${directory}/calendar-adapters.tsx`,
        '@core/user/dmActivity': `${directory}/calendar-adapters.tsx`,
        '@core/component/EntityIcon': `${directory}/calendar-adapters.tsx`,
        '@core/user/use-contact-filter-options': `${directory}/list-filter-adapters.tsx`,
        '@app/lib/analytics/posthog': `${directory}/list-filter-adapters.tsx`,
        '@property/tags/use-tag-filter-group': `${directory}/list-filter-adapters.tsx`,
        '../context/drive-context': `${directory}/list-filter-adapters.tsx`,
        '../email-view/filters/use-email-filters': `${directory}/list-filter-adapters.tsx`,
        'loro-crdt': 'loro-crdt/base64',
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: { host: '127.0.0.1', strictPort: true },
});
