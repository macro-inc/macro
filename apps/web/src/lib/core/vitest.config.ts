import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    wasm(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      {
        find: '@solid-primitives/refs',
        replacement: fileURLToPath(
          new URL(
            '../../../../../node_modules/@solid-primitives/refs/dist/index.js',
            import.meta.url
          )
        ),
      },
      {
        find: '@solid-primitives/transition-group',
        replacement: fileURLToPath(
          new URL(
            '../../../../../node_modules/@solid-primitives/transition-group/dist/index.js',
            import.meta.url
          )
        ),
      },
      {
        find: 'solid-transition-group',
        replacement: fileURLToPath(
          new URL(
            '../../../../../node_modules/solid-transition-group/dist/index.js',
            import.meta.url
          )
        ),
      },
      { find: /^loro-crdt$/, replacement: 'loro-crdt/base64' },
    ],
  },
  ssr: {
    resolve: { conditions: ['browser', 'development'] },
  },
  test: {
    // Prebundling transition dependencies creates a second Solid runtime.
    deps: {
      optimizer: {
        client: {
          enabled: false,
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
