import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    deps: {
      optimizer: {
        client: {
          include: ['solid-js', '@tanstack/solid-query', 'zod'],
        },
      },
    },
    // One native solid-js per worker; see ../core/vitest.config.ts.
    server: { deps: { external: [/[\\/]node_modules[\\/]solid-js[\\/]/] } },
  },
} as any);
