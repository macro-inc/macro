import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import core from '../../core/vitest.config.ts';

/**
 * Headless harnesses: the production cache chain over the real cache-wasm
 * engine, in jsdom with no browser. Run from `apps/web`:
 * `bunx vitest run --config src/lib/graphql-cache/headless/vitest.config.ts`.
 * Build the engine first (`just build-cache-wasm`).
 */
export default mergeConfig(
  core,
  defineConfig({
    root: fileURLToPath(new URL('../../../..', import.meta.url)),
    test: {
      name: 'cache-harness',
      include: ['src/**/*.harness.{ts,tsx}'],
      setupFiles: [fileURLToPath(new URL('./setup.ts', import.meta.url))],
      // Scenarios open several engines and seed thousands of rows.
      testTimeout: 300_000,
      hookTimeout: 300_000,
    },
  })
);
