import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

// Keep Drive redesign browser fixture optimization independent of a running preview.
export default defineConfig(async (environment) => {
  const base = await createAppViteConfig()(environment);
  return {
    ...base,
    server: {
      ...base.server,
      host: '127.0.0.1',
    },
    cacheDir: 'node_modules/.vite-drive-redesign-tests',
    optimizeDeps: {
      ...base.optimizeDeps,
      entries: ['src/features/drive-view/browser-test/drive-redesign.html'],
      include: [
        ...(base.optimizeDeps?.include ?? []),
        '@solid-primitives/keyed',
      ],
    },
  };
});
