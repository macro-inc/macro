import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    solid(),
    tsconfigPaths({
      projects: [
        fileURLToPath(new URL('../../../../../tsconfig.json', import.meta.url)),
      ],
    }),
  ],
  resolve: { dedupe: ['solid-js'] },
  server: { host: '127.0.0.1', strictPort: true },
});
