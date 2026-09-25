import path from 'node:path';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { solidSvgOptions } from './vite.svgo';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(import.meta.dirname, 'tsconfig.json')],
    }),
    solid(),
    solidSvg({ ...solidSvgOptions, defaultAsComponent: true }),
  ],
  resolve: { dedupe: ['solid-js'] },
  ssr: { resolve: { conditions: ['browser', 'development'] } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});
