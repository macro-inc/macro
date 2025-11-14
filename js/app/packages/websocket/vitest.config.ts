import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    globals: false,
    environment: 'jsdom',
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
});
