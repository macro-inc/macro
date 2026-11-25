import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

// Keep Drive redesign browser fixture optimization independent of a running preview.
export default defineConfig((environment) => ({
  ...createAppViteConfig()(environment),
  cacheDir: 'node_modules/.vite-drive-redesign-tests',
}));
