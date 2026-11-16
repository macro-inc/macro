import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import { createAppViteConfig } from '../../vite.base';

const directory = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191);

/** This bundle ships nowhere, so the production size limits don't apply. */
const SHIPPING_CHECKS = [
  'posthog-source-map-limit',
  'cloudfront-compression-limit',
];
const withoutShippingChecks = (plugins: PluginOption[] = []) =>
  plugins
    .flat()
    .filter(
      (plugin) =>
        !(
          plugin &&
          typeof plugin === 'object' &&
          'name' in plugin &&
          SHIPPING_CHECKS.includes(plugin.name)
        )
    );

export default defineConfig(async (environment) => {
  const app = await createAppViteConfig()(environment);
  return {
    ...app,
    base: '/',
    plugins: withoutShippingChecks(app.plugins),
    worker: {
      ...app.worker,
      plugins: () => withoutShippingChecks(app.worker?.plugins?.()),
    },
    cacheDir: 'node_modules/.vite-functional',
    build: {
      ...app.build,
      // node_modules keeps the bundle out of git, tsc and Biome.
      outDir: resolve(directory, '../../node_modules/.functional-dist'),
      minify: false,
      sourcemap: false,
      rolldownOptions: {
        input: {
          optimisticMutations: resolve(
            directory,
            'optimistic-mutations/index.html'
          ),
          whatsappLinked: resolve(directory, 'whatsapp-linked/index.html'),
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
    },
    preview: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  };
});
