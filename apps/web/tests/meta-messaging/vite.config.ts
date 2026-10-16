import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../vite.base';

// Synthetic transport only: no developer credentials or hosted backends.
Object.assign(process.env, {
  MODE: 'development',
  VITE_LOCAL_SERVERS: 'ALL',
  VITE_ENABLE_GRAPHQL_SOUP: 'true',
  VITE_LOCAL_BACKEND_ORIGIN: 'same-origin',
  VITE_DISABLE_BROWSER_TURSO_CACHE: 'true',
  VITE_ENABLE_IN_APP_TOURS: 'false',
  VITE_ENABLE_BROWSER_OTEL: 'false',
});
export default defineConfig((env) =>
  mergeConfig(createAppViteConfig()(env), {
    envDir: import.meta.dirname,
    cacheDir: 'node_modules/.vite-meta-messaging-browser',
    build: { outDir: '/tmp/macro-messaging-browser-dist', sourcemap: false },
    preview: { host: '127.0.0.1', port: 3041, strictPort: true },
  })
);
