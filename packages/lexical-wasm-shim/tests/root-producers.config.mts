import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/__tests__/root-exports.test.ts',
      'src/__tests__/root-basic-exports.test.ts',
      'src/nodes/tests/predicates.test.ts',
      'src/utilities/tests/tree.test.ts',
      'src/utilities/tests/dom-config.test.ts',
      'src/__tests__/build-import-map.test.ts',
      'src/caret/caret.test.ts',
      'src/caret/comparison.test.ts',
      'src/utilities/utilities.test.ts',
      'src/extension-core/helpers.test.ts',
    ],
    setupFiles: ['./src/__tests__/setup.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
});
