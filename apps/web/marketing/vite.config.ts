import path from 'node:path';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { solidSvgOptions } from './vite.svgo';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    solid(),
    solidSvg({ ...solidSvgOptions, defaultAsComponent: true }),
    tailwind(),
    tsconfigPaths({ projects: ['../tsconfig.json'] }),
  ],
  worker: { format: 'es' },
  build: {
    outDir: '../dist-site',
    emptyOutDir: true,
    target: 'esnext',
    manifest: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        site: path.resolve(import.meta.dirname, 'index.html'),
        start: path.resolve(import.meta.dirname, 'start.html'),
      },
    },
  },
});
