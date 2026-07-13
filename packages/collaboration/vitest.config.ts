import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['./vitest.collab.config.ts', './vitest.transport.config.ts'],
  },
});
