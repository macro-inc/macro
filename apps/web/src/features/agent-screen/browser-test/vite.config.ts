import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

const directory = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('../../../', import.meta.url));
const stub = (name: string) => `${directory}stubs/${name}.ts`;

// The split header and the phone header need a real split panel; the fixture
// draws its own and these stand-ins portal into it.
const STAND_INS = [
  {
    find: /^@components\/app\/split-layout\/components\/SplitHeader$/,
    replacement: `${directory}/stand-ins.tsx`,
  },
  {
    find: /^@components\/app\/mobile-header\/mobile-header$/,
    replacement: `${directory}/stand-ins.tsx`,
  },
];

/**
 * The DM header's data, by resolved file so relative imports get it too:
 * each stub re-exports the real module and replaces only the hooks that
 * would query the backend.
 */
const STUBBED_FILES: Record<string, string> = {
  [`${src}lib/core/context/channels.ts`]: stub('channels'),
  [`${src}lib/core/context/user.ts`]: stub('user-context'),
  [`${src}lib/core/user/displayName.ts`]: stub('display-name'),
  [`${src}features/channel/use-channel-participants.ts`]: stub(
    'channel-participants'
  ),
  [`${src}features/settings/primitives/team-agent-status.ts`]:
    stub('team-agent-status'),
  [`${src}features/channel/Call/use-call.ts`]: stub('use-call'),
  [`${src}components/app/GlobalAppState.tsx`]: stub('global-app-state'),
  [`${src}features/agent-screen/screen-user-action.ts`]:
    stub('screen-user-action'),
};

function stubFiles(): Plugin {
  return {
    name: 'agent-screen-fixture-stub-files',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer?.startsWith(`${directory}stubs/`)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ? (STUBBED_FILES[resolved.id] ?? null) : null;
    },
  };
}

// Keep browser fixture optimization independent of a running native preview.
export default defineConfig(async (environment) => {
  const base: UserConfig = await createAppViteConfig()(environment);
  const alias = base.resolve?.alias;
  return {
    ...base,
    plugins: [stubFiles(), ...(base.plugins ?? [])],
    cacheDir: 'node_modules/.vite-agent-screen-tests',
    // A test run edits nothing; watching the app's tree only uses up the
    // machine's file watchers.
    server: { ...base.server, watch: null },
    resolve: {
      ...base.resolve,
      alias: [...STAND_INS, ...(Array.isArray(alias) ? alias : [])],
    },
  };
});
