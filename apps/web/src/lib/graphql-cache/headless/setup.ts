/**
 * Setup for headless harnesses (`*.harness.ts`): the engine worker's
 * `loadCacheWasm` hands out the real cache-wasm build, loaded from disk once
 * per test file. Everything else in the module is the engine worker's own.
 */
import { vi } from 'vitest';

vi.mock('../worker/wasm-module', async () => {
  const { loadRealCacheWasm } = await import('./real-engine');
  let memoryBytes: (() => number) | undefined;
  return {
    loadCacheWasm: async () => {
      const engine = await loadRealCacheWasm();
      memoryBytes = engine.linearMemoryBytes;
      return engine.module;
    },
    // Each worker compiles the module itself, as without a page to share it.
    setCompiledEngineExchange: () => {},
    cacheWasmLinearMemoryBytes: () => {
      if (!memoryBytes) throw new Error('cache WASM memory is not initialized');
      return memoryBytes();
    },
  };
});
