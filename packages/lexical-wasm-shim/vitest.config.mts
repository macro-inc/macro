import { defineConfig } from 'vitest/config';
import { buildWasm } from '../lexical-conformance/diff/build-wasm.ts';

buildWasm();
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
});
