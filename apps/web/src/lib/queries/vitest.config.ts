import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Anchored to this file rather than given as a relative path: the plugin
    // resolves a relative `root` against the root of whichever project extends
    // this config, which for `apps/web` projects lands on the filesystem root
    // and crawls the whole machine for tsconfigs.
    tsconfigPaths({
      root: fileURLToPath(new URL('../../../', import.meta.url)),
    }),
    solidPlugin(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    deps: {
      optimizer: {
        web: {
          include: ['solid-js', '@tanstack/solid-query', 'zod'],
        },
      },
    },
  },
} as any);
