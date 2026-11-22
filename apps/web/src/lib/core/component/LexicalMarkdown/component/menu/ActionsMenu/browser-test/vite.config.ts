import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../../../../vite.base';

// Build the actual source fixture with the application aliases/plugins and rules.
export default defineConfig(async (environment) => {
  const config = await createAppViteConfig()(environment);
  return {
    ...config,
    base: '/',
    build: {
      ...config.build,
      outDir:
        process.env.ACTIONS_MENU_TEST_BUNDLE_DIR ??
        fileURLToPath(new URL('./dist', import.meta.url)),
      rollupOptions: {
        ...config.build?.rollupOptions,
        input: fileURLToPath(new URL('./control.html', import.meta.url)),
      },
    },
  };
});
