import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { botsBoundary } from './scripts/botsBoundary.ts';

export default defineConfig(({ command, mode, isPreview }) => ({
  root: import.meta.dirname,
  plugins: [botsBoundary(mode === 'local-fixture'), solid()],
  define: {
    __BOTS_FIXTURES__:
      (command === 'serve' && !isPreview) || mode === 'local-fixture',
  },
  server: { host: '127.0.0.1', port: 23030, strictPort: true },
  preview: {
    host: '127.0.0.1',
    port: 23030,
    strictPort: true,
    allowedHosts: process.env.BOTS_PREVIEW_HOST
      ? [process.env.BOTS_PREVIEW_HOST]
      : [],
  },
  build: {
    outDir: mode === 'local-fixture' ? 'dist-local' : 'dist',
    target: 'esnext',
    manifest: true,
    modulePreload: { polyfill: false },
  },
}));
