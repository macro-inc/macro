import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const flags = fileURLToPath(new URL('./flags.ts', import.meta.url));
export default defineConfig({
  plugins: [solid()],
  optimizeDeps: {
    entries: ['src/lib/core/document-session/browser-test/index.html'],
  },
  resolve: {
    alias: [
      { find: '@app/lib/analytics/posthog', replacement: flags },
      { find: '@core/constant/featureFlags', replacement: flags },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.EDITOR_ENGINE_TEST_PORT ?? 3092),
    strictPort: true,
    fs: { allow: ['../..'] },
  },
});
