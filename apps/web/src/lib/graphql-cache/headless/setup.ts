/**
 * Setup for headless harnesses (`*.harness.ts`): the engine worker's
 * `loadCacheWasm` hands out the real cache-wasm instance of the runtime that
 * is installed (`installHeadlessCacheRuntime`). Everything else in the module
 * is the engine worker's own.
 */
import { vi } from 'vitest';

vi.mock('../worker/wasm-module', async () => {
  const { currentRealCacheWasm } = await import('./real-engine');
  return {
    loadCacheWasm: async () => currentRealCacheWasm().module,
    // Each worker compiles the module itself, as without a page to share it.
    setCompiledEngineExchange: () => {},
    cacheWasmLinearMemoryBytes: () =>
      currentRealCacheWasm().linearMemoryBytes(),
  };
});
