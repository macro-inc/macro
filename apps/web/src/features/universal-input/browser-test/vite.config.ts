import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

/** Swaps `sources` for a fixture when imported from a file ending in one of `importers`, or from anywhere without them. */
type TestAdapter = { importers?: string[]; sources: string[]; fixture: string };

const TEST_ADAPTERS: TestAdapter[] = [
  {
    importers: ['/mobile/MobileSearchResults.tsx'],
    sources: [
      './create-mobile-search-entry',
      '@core/context/user',
      '@components/app/split-layout/layoutUtils',
    ],
    fixture: 'mobile-search-app-fixture.ts',
  },
  {
    importers: ['/mobile/MobileSearchResults.tsx'],
    sources: [
      '@app/features/crm/record-adapter',
      '@queries/storage/databases',
      '@components/app/split-layout/layout',
    ],
    fixture: 'search-app-fixture.ts',
  },
  {
    importers: [
      '/mobile/create-search-result-window.ts',
      '/mobile/create-search-scroll-restoration.ts',
    ],
    sources: ['@components/app/split-layout/layoutUtils'],
    fixture: 'mobile-search-app-fixture.ts',
  },
  {
    importers: ['/mobile/MobileSearchInput.tsx'],
    sources: ['@components/app/mobile/use-mobile-nav'],
    fixture: 'search-app-fixture.ts',
  },
  {
    importers: ['/mobile/MobileSearchInput.tsx'],
    sources: ['../../universal-input/universal-input'],
    fixture: 'command-input-fixture.tsx',
  },
  {
    importers: ['/next-soup/open-search.ts'],
    sources: ['@components/app/split-layout/layout'],
    fixture: 'search-app-fixture.ts',
  },
  {
    sources: ['@app/lib/analytics/posthog'],
    fixture: 'feature-flags-fixture.ts',
  },
  {
    importers: ['/queries/soup/search.ts'],
    sources: ['@service-search/client'],
    fixture: 'global-search-service-fixture.ts',
  },
  {
    importers: ['/queries/soup/items.ts'],
    sources: ['@service-storage/client'],
    fixture: 'global-search-service-fixture.ts',
  },
  {
    importers: ['/command/CommandMenu.tsx'],
    sources: ['../universal-input/universal-input'],
    fixture: 'command-input-fixture.tsx',
  },
  // Keep the app-wide entity-search menu outside this composer fixture.
  // The real shared editors, formatting tools and recipient controls run here.
  {
    importers: ['/component/core/MarkdownTextarea.tsx'],
    sources: ['../menu/MentionsMenu', '../menu/SnippetsMenu'],
    fixture: 'mention-menu-fixture.tsx',
  },
  {
    importers: ['/builder/MarkdownShell.tsx'],
    sources: [
      '../component/menu/MentionsMenu',
      '../component/menu/SnippetsMenu',
    ],
    fixture: 'mention-menu-fixture.tsx',
  },
  {
    importers: ['/command/open-command-result.ts'],
    sources: ['@components/app/split-layout/layout'],
    fixture: 'search-app-fixture.ts',
  },
  {
    importers: ['/command/CommandMenu.tsx'],
    sources: [
      '@components/app/split-layout/layout',
      '@app/lib/analytics/analytics-context',
      '@app/features/crm/record-adapter',
      '@queries/storage/databases',
    ],
    fixture: 'search-app-fixture.ts',
  },
];

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    {
      name: 'composer-test-adapters',
      enforce: 'pre',
      resolveId(source, importer) {
        const adapter = TEST_ADAPTERS.find(
          (rule) =>
            rule.sources.includes(source) &&
            (!rule.importers ||
              rule.importers.some((suffix) => importer?.endsWith(suffix)))
        );
        return adapter && `${directory}/${adapter.fixture}`;
      },
    },
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3007,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
  build: {
    target: 'esnext',
    outDir: `${directory}/.dist`,
    emptyOutDir: true,
  },
});
