import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      // Relative to the working directory, not to this file: from apps/web
      // '../../../' escapes the repository and makes the plugin crawl the
      // whole filesystem for tsconfigs, which fails outright where / holds
      // unreadable directories such as Linux /proc.
      root: fileURLToPath(new URL('../../../', import.meta.url)),
    }),
    solidPlugin(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
