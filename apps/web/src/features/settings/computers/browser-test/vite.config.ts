import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const stub = (name: string) => `${directory}/stubs/${name}.ts`;
/** Exactly this specifier, not its subpaths (`@core/user` vs `@core/user/util`). */
const exact = (specifier: string) =>
  new RegExp(`^${specifier.replace(/[/.]/g, '\\$&')}$`);

/**
 * Modules reached by relative paths as well as by alias: every import that
 * resolves to the real file gets the stub.
 */
const stubbedFiles: Record<string, string> = {
  [`${webDirectory}src/lib/core/context/user.ts`]: stub('user-context'),
  // The composer's mention menu fetches booking links; mentions are not
  // under test.
  [`${webDirectory}src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/hooks/useBookingLinkMention.ts`]:
    stub('booking-link-mention'),
};

function stubFiles(): Plugin {
  return {
    name: 'computers-fixture-stub-files',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer?.startsWith(`${directory}stubs/`)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ? (stubbedFiles[resolved.id] ?? null) : null;
    },
  };
}

/**
 * Mounts the real Macro computers section over the real computers queries and
 * service client, so Playwright can answer `/team/computers/*` itself. Only
 * the app's shell (account, team, feature flags, other queries) is stubbed.
 */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    stubFiles(),
    tailwindcss(),
    wasm(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      { find: exact('@queries/client'), replacement: stub('query-client') },
      {
        find: exact('@queries/harnesses/harnesses'),
        replacement: stub('harnesses'),
      },
      { find: exact('@queries/team/teams'), replacement: stub('teams') },
      { find: exact('@queries/agents/agents'), replacement: stub('agents') },
      { find: exact('@queries/bots/bots'), replacement: stub('bots') },
      { find: exact('@queries/computers/claude'), replacement: stub('claude') },
      {
        find: exact('@app/lib/analytics/posthog'),
        replacement: stub('posthog'),
      },
      { find: exact('@core/context/user'), replacement: stub('user-context') },
      { find: exact('@core/user'), replacement: stub('user') },
      {
        find: exact('@core/constant/SettingsState'),
        replacement: stub('settings'),
      },
      {
        find: exact('@components/app/split-layout/layout'),
        replacement: stub('split-layout'),
      },
      {
        find: exact('@app/features/agents-view/primitives/open-page'),
        replacement: stub('open-page'),
      },
      {
        find: exact('@app/features/access-requests/access-requests'),
        replacement: stub('access-requests'),
      },
    ],
  },
  // Same-origin service URLs, so the test's routes see `/auth/team/computers/*`.
  define: { 'import.meta.env.VITE_LOCAL_BACKEND_ORIGIN': '"same-origin"' },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    // The composer and Agents settings load lazily, after Try it or Create
    // agent; scan them up front so their dependencies never re-optimize (and
    // reload the page) mid-test.
    entries: ['index.html', 'composer.tsx', 'agent-settings.tsx'],
  },
  server: { host: '127.0.0.1', strictPort: true },
});
