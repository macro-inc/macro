import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solid()],
  resolve: { dedupe: ['solid-js'], conditions: ['browser', 'development'] },
  test: {
    name: 'graphics',
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
