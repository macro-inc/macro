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

/**
 * Back routing needs no panel content, and the real panel mounts most of the
 * app, so the Android Back fixture gets an empty one.
 */
const stubSplitPanel = {
  name: 'email-compose-fixture-stub-split-panel',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (
      source.endsWith('/components/SplitPanel') &&
      importer?.endsWith('MobileSplitContainer.tsx')
    ) {
      return fileURLToPath(new URL('./split-panel-stub.tsx', import.meta.url));
    }
  },
};

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    stubSplitPanel,
    {
      name: 'sender-fixture-context',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          importer?.endsWith('/email-view/components/EmailInboxSelector.tsx') &&
          source === '../email-view-context'
        )
          return fileURLToPath(
            new URL('./sender-adapters.tsx', import.meta.url)
          );
      },
    },

    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    // Exact matches only: `@ui/…` subpaths resolve to the real components.
    alias: [
      {
        find: /^@ui$/,
        replacement: fileURLToPath(new URL('./ui-shim.ts', import.meta.url)),
      },
      ...[
        '@core/component/UserIcon',
        '@core/component/inboxIcon',
        '@queries/email/mail-accounts',
        '@app/lib/analytics/posthog',
        '@core/email-link',
        '@app/components/view-shell',
      ].map((name) => ({
        find: name,
        replacement: fileURLToPath(
          new URL('./sender-adapters.tsx', import.meta.url)
        ),
      })),
      { find: /^loro-crdt$/, replacement: 'loro-crdt/base64' },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 3018,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
  build: {
    target: 'esnext',
    outDir: `${directory}/.dist`,
    emptyOutDir: true,
  },
});
