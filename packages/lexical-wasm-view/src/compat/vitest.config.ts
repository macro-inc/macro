import { defineConfig } from 'vitest/config';
import { compatSourcePlugin, upstreamAliases } from './upstream-harness';
export default defineConfig({
  plugins: [compatSourcePlugin(process.env.COMPAT_BASELINE === 'upstream')],
  resolve: { alias: upstreamAliases },
  test: {
    include: ['src/compat/**/*.spec.ts'],
    exclude:
      process.env.COMPAT_BASELINE === 'upstream'
        ? ['src/compat/lifecycle.spec.ts']
        : [],
    environment: 'jsdom',
    maxWorkers: 1,
    setupFiles: ['src/compat/test-setup.ts'],
  },
});
