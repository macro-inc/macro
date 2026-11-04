import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
const appConfig = createAppViteConfig();

// The app's config, with the dependency scan starting from this fixture so a
// cold dev server bundles every dependency before the first load.
export default defineConfig(async (env) =>
  mergeConfig(await appConfig(env), {
    cacheDir: `${directory}.vite`,
    optimizeDeps: {
      entries: ['src/features/database/browser-test/grid.html'],
    },
  })
);
