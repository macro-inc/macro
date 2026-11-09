import { defineConfig } from 'vitest/config';

// JS configuration controls use the existing real conformance artifact. This
// configuration deliberately starts no native build during timing windows.
export default defineConfig({
  test: {
    include: ['src/__tests__/editor-html-editable.test.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    environment: 'jsdom',
    maxWorkers: 1,
  },
});
