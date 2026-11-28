import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { botsBoundary } from './scripts/botsBoundary.ts';

export default defineConfig(({ mode }) => ({
  root: import.meta.dirname,
  base: mode === 'local-native' ? '/bots/' : '/',
  resolve: {
    alias: {
      '@macro-inc/sdk/generated/auth': fileURLToPath(
        new URL('../../packages/sdk/generated/auth/index.ts', import.meta.url)
      ),
    },
  },
  plugins: [botsBoundary(mode === 'local-fixture'), solid()],
  define: {
    __BOTS_FIXTURES__: mode === 'local-fixture',
    __BOTS_NATIVE__: mode === 'local-native',
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
