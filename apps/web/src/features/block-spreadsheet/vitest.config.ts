import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export default defineConfig({
  root,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({
      projects: [
        fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
      ],
    }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: { 'loro-crdt': 'loro-crdt/base64' },
  },
  test: {
    maxWorkers: 4,
    environment: 'jsdom',
    include: ['src/features/block-spreadsheet/**/*.{test,spec}.{ts,tsx}'],
  },
});
