import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import svg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspace = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const stubs = `${directory}/stubs.ts`;
export default defineConfig({
  root: directory,
  cacheDir: '/tmp/macro-link-preview-vite',
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  plugins: [
    solid(),
    svg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${web}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      '@channel/Thread/utils/message-actions',
      '@core/context/user',
      '@core/util/url',
      '@core/util/webOrigin',
      '@queries/messages/mutations',
      '@service-unfurl/client',
      '@ui',
    ].map((find) => ({ find, replacement: stubs })),
  },
  server: {
    host: '127.0.0.1',
    port: 3007,
    strictPort: true,
    fs: { allow: [workspace] },
  },
});
