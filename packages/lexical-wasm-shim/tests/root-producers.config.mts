import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/__tests__/root-exports.test.ts',
      'src/caret/caret.test.ts',
      'src/caret/comparison.test.ts',
      'src/utilities/utilities.test.ts',
      'src/extension-core/helpers.test.ts',
    ],
    setupFiles: ['./src/__tests__/setup.ts'],
    environment: 'jsdom',
    maxWorkers: 1,
  },
});
