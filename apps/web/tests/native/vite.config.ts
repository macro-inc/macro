import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../vite.base';

export default defineConfig((env) =>
  mergeConfig(createAppViteConfig()(env), {
    // Never load the developer's .env (tokens, hosted origins, feature overrides).
    envDir: import.meta.dirname,
    cacheDir: 'node_modules/.vite-native-e2e',
    server: { host: '127.0.0.1', port: 3009, strictPort: true },
  })
);
