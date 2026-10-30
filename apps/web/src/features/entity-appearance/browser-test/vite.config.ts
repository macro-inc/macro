import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(async (env) =>
  mergeConfig(await createAppViteConfig()(env), {
    cacheDir: `${directory}.vite`,
    optimizeDeps: {
      entries: ['src/features/entity-appearance/browser-test/appearance.html'],
    },
  })
);
