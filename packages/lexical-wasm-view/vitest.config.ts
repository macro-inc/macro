import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['browser'], dedupe: ['solid-js'] },
  ssr: { resolve: { conditions: ['browser', 'development'] } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    server: { deps: { inline: ['solid-js'] } },
  },
});
