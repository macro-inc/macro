import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    dedupe: ['solid-js'],
    conditions: ['browser', 'development'],
  },
  ssr: {
    resolve: {
      conditions: ['browser', 'development'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts'],
    name: 'machine',
  },
});
