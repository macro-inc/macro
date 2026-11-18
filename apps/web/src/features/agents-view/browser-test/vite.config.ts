import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

export default defineConfig((environment) => ({
  ...createAppViteConfig()(environment),
  cacheDir: 'node_modules/.vite-agents-browser-tests',
}));
