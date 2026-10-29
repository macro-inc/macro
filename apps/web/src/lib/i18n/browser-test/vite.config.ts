import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
const appConfig = createAppViteConfig();

// The app's config, with the dependency scan starting from this fixture: a
// cold dev server then bundles every dependency before the first load rather
// than re-bundling mid-load, which leaves the page on stale chunk URLs.
export default defineConfig(async (env) =>
  mergeConfig(await appConfig(env), {
    cacheDir: `${directory}.vite`,
    optimizeDeps: { entries: ['src/lib/i18n/browser-test/menus.html'] },
  })
);
