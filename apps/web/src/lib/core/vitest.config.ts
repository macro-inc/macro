import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: '../../../',
    }),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    wasm(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@solid-primitives/refs': fileURLToPath(
        new URL(
          '../../../../../node_modules/@solid-primitives/refs/dist/index.js',
          import.meta.url
        )
      ),
      '@solid-primitives/transition-group': fileURLToPath(
        new URL(
          '../../../../../node_modules/@solid-primitives/transition-group/dist/index.js',
          import.meta.url
        )
      ),
      'loro-crdt': 'loro-crdt/base64',
    },
  },
  test: {
    deps: {
      optimizer: {
        web: {
          enabled: true,
          include: [
            'solid-transition-group',
            '@solid-primitives/refs',
            '@solid-primitives/transition-group',
          ],
        },
      },
    },
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        inline: [
          'solid-transition-group',
          '@solid-primitives/refs',
          '@solid-primitives/transition-group',
        ],
      },
    },
  },
} as any);
