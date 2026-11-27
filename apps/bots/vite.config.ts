import { type ConfigEnv, defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { botsBoundary } from './scripts/botsBoundary.ts';

export const botsConfig = ({ command, mode, isPreview }: ConfigEnv) => ({
  root: import.meta.dirname,
  plugins: [botsBoundary(mode === 'local-fixture'), solid()],
  define: {
    __BOTS_LOCAL_AUTH__: JSON.stringify(''),
    __BOTS_SIGNED_VAULT__: false,
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
});

export default defineConfig((env) => {
  if (env.mode === 'local-auth' || env.mode === 'local-passwords') {
    throw new Error('Bots local auth requires the dedicated dev:auth command');
  }
  return botsConfig(env);
});
