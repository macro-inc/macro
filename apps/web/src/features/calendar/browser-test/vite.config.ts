import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const port = Number(process.env.CALENDAR_DESCRIPTION_TEST_PORT ?? 43917);
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [tailwind()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../../../lib/core', import.meta.url)),
    },
  },
  optimizeDeps: {
    entries: ['src/features/calendar/browser-test/description.html'],
  },
  cacheDir: process.env.CALENDAR_DESCRIPTION_TEST_CACHE,
  server: { host: '127.0.0.1', port, strictPort: true },
});
