import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const artifact = process.env.COLLECTOR_NATIVE_ARTIFACT_ROOT;
const source = process.env.COLLECTOR_NATIVE_SOURCE_ROOT;
const proof = process.env.COLLECTOR_NATIVE_PROOF_DIR;
if (!artifact || !source || !proof)
  throw new Error(
    'Collector native tests require explicit artifact, source and proof directories'
  );
export default defineConfig({
  cacheDir: resolve(process.env.TMPDIR ?? '/tmp', 'collector-native-vite'),
  resolve: {
    alias: [
      {
        find: '@macro-inc/collaboration/session/wasm-compat',
        replacement: resolve(proof, 'measured.mjs'),
      },
      {
        find: '@macro-inc/collaboration/session/compatibility.generated',
        replacement: resolve(
          source,
          'packages/collaboration/src/session/compatibility.generated.ts'
        ),
      },
      {
        find: '@macro-inc/collaboration/session/abi.generated',
        replacement: resolve(
          source,
          'packages/collaboration/src/session/abi.generated.ts'
        ),
      },
      {
        find: '@macro-inc/collaboration/session/foreign-native-fields.generated',
        replacement: resolve(
          source,
          'packages/collaboration/src/session/foreign-native-fields.generated.ts'
        ),
      },
      {
        find: '@macro-inc/collaboration/session/input',
        replacement: resolve(
          source,
          'packages/collaboration/src/session/input.ts'
        ),
      },
    ],
  },
  test: {
    include: [resolve(import.meta.dirname, '*.test.ts')],
    environment: 'node',
    maxWorkers: 1,
    execArgv: ['--expose-gc'],
    testTimeout: 30000,
  },
});
