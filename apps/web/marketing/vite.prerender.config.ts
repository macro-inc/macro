// Build config for the prerender SSR bundle (scripts/prerenderEntry.tsx).
// Kept separate from vite.config.ts so the main client build is untouched.

import path from 'node:path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { standaloneBoundary } from './scripts/standaloneBoundary';
import { solidSvgOptions } from './vite.svgo';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    standaloneBoundary(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    solidPlugin({ ssr: true, solid: { hydratable: true } }),
    solidSvg(solidSvgOptions),
  ],
  resolve: {
    alias: {
      '@animal': path.resolve(__dirname, './src/lib/animal'),
      '@svggg': path.resolve(__dirname, './src/lib/svggg'),
      '@theme': path.resolve(__dirname, './src/lib/theme'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@app': path.resolve(__dirname, './src/app'),
    },
  },
  build: {
    ssr: path.resolve(__dirname, 'scripts/prerenderEntry.tsx'),
    outDir: '../dist-site-prerender',
    emptyOutDir: true,
    target: 'esnext',
  },
});
