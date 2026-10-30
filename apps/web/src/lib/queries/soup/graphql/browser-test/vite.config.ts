import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB = fileURLToPath(new URL('../../../../../../', import.meta.url));
const RUNTIME = fileURLToPath(new URL('./runtime.ts', import.meta.url));

export default defineConfig({
  root: DIRECTORY,
  plugins: [
    {
      name: 'mail-flicker-composition',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          (importer?.endsWith('/graphql/create-soup-live-query.ts') &&
            source ===
              '../../../service-clients/service-storage/graphql-soup') ||
          (importer?.endsWith('/graphql/optimistic-deletions.ts') &&
            source === '../../client')
        )
          return RUNTIME;
      },
    },
    solid(),
    tsconfigPaths({ projects: [`${WEB}/tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  define: { __CACHE_WASM_BUILD_MODE__: JSON.stringify('development') },
  server: { host: '127.0.0.1', port: 4196, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'esnext' },
});
