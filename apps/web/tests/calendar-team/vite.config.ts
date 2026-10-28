import { defineConfig, mergeConfig } from 'vite';
import { createAppViteConfig } from '../../vite.base';

// Pin a synthetic local environment without loading developer credentials or hosted origins.
Object.assign(process.env, {
  MODE: 'development',
  VITE_LOCAL_SERVERS: 'ALL',
  VITE_LOCAL_BACKEND_ORIGIN: 'same-origin',
  VITE_ENABLE_CALENDAR_UI: 'true',
  VITE_ENABLE_CALENDAR_TEAM_SHARING: 'true',
  VITE_ENABLE_CALENDAR_TEAM_OOO: 'true',
  VITE_ENABLE_GRAPHQL_CALENDAR: 'false',
  VITE_DISABLE_BROWSER_TURSO_CACHE: 'true',
  VITE_ENABLE_IN_APP_TOURS: 'false',
  VITE_ENABLE_BROWSER_OTEL: 'false',
});
export default defineConfig((env) =>
  mergeConfig(createAppViteConfig()(env), {
    envDir: import.meta.dirname,
    cacheDir: 'node_modules/.vite-calendar-team-browser',
    build: { outDir: '/tmp/calendar-team-browser-dist', sourcemap: false },
    preview: { host: '127.0.0.1', port: 3037, strictPort: true },
  })
);
