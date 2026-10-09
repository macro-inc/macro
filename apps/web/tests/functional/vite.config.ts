import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../vite.base';

export default defineConfig((environment) => ({
  ...createAppViteConfig()(environment),
  cacheDir: 'node_modules/.vite-functional',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191),
    strictPort: true,
    hmr: false,
  },
}));
