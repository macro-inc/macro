import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

const directory = fileURLToPath(new URL('.', import.meta.url));

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

// Keep browser fixture optimization independent of a running native preview.
export default defineConfig(async (environment) => {
  const base: UserConfig = await createAppViteConfig()(environment);
  const alias = base.resolve?.alias;
  return {
    ...base,
    cacheDir: 'node_modules/.vite-agent-screen-tests',
    resolve: {
      ...base.resolve,
      alias: [...STAND_INS, ...(Array.isArray(alias) ? alias : [])],
    },
  };
});
