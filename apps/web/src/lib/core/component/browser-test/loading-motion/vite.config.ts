import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../vite.base';

// Keep browser fixture optimization independent of a running native preview.
export default defineConfig((environment) => ({
  ...createAppViteConfig()(environment),
  cacheDir: 'node_modules/.vite-loading-motion-tests',
}));
