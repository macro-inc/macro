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

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    {
      name: 'composer-test-adapters',
      enforce: 'pre',
      resolveId(source, importer) {
        if (importer?.endsWith('/mobile/MobileSearchResults.tsx')) {
          if (
            [
              './create-mobile-search-entry',
              '@core/context/user',
              '@components/app/split-layout/layoutUtils',
            ].includes(source)
          )
            return `${directory}/mobile-search-app-fixture.ts`;
          if (
            [
              '@app/features/crm/record-adapter',
              '@queries/storage/databases',
              '@components/app/split-layout/layout',
            ].includes(source)
          )
            return `${directory}/search-app-fixture.ts`;
        }
        if (
          source === '@components/app/split-layout/layoutUtils' &&
          (importer?.endsWith('/mobile/create-search-result-window.ts') ||
            importer?.endsWith('/mobile/create-search-scroll-restoration.ts'))
        )
          return `${directory}/mobile-search-app-fixture.ts`;
        if (importer?.endsWith('/mobile/MobileSearchInput.tsx')) {
          if (source === '@components/app/mobile/use-mobile-nav')
            return `${directory}/search-app-fixture.ts`;
          if (source === '../../universal-input/universal-input')
            return `${directory}/command-input-fixture.tsx`;
        }
        if (
          source === '@components/app/split-layout/layout' &&
          importer?.endsWith('/next-soup/open-search.ts')
        )
          return `${directory}/search-app-fixture.ts`;

        if (source === '@app/lib/analytics/posthog')
          return `${directory}/feature-flags-fixture.ts`;
        if (
          (importer?.endsWith('/queries/soup/search.ts') &&
            source === '@service-search/client') ||
          (importer?.endsWith('/queries/soup/items.ts') &&
            source === '@service-storage/client')
        )
          return `${directory}/global-search-service-fixture.ts`;

        if (
          importer?.endsWith('/command/CommandMenu.tsx') &&
          source === '../universal-input/universal-input'
        )
          return `${directory}/command-input-fixture.tsx`;
        // Keep the app-wide entity-search menu outside this composer fixture.
        // The real shared editors, formatting tools and recipient controls run here.
        if (
          (importer?.endsWith('/component/core/MarkdownTextarea.tsx') &&
            ['../menu/MentionsMenu', '../menu/SnippetsMenu'].includes(
              source
            )) ||
          (importer?.endsWith('/builder/MarkdownShell.tsx') &&
            [
              '../component/menu/MentionsMenu',
              '../component/menu/SnippetsMenu',
            ].includes(source))
        )
          return `${directory}/mention-menu-fixture.tsx`;
        if (
          source === '@components/app/split-layout/layout' &&
          importer?.endsWith('/command/open-command-result.ts')
        )
          return `${directory}/search-app-fixture.ts`;
        if (
          importer?.endsWith('/command/CommandMenu.tsx') &&
          [
            '@components/app/split-layout/layout',
            '@app/lib/analytics/analytics-context',
            '@app/features/crm/record-adapter',
            '@queries/storage/databases',
          ].includes(source)
        )
          return `${directory}/search-app-fixture.ts`;
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
