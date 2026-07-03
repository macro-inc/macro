/**
 * Typed surface of the generated wasm package (`cache-wasm`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-cache-wasm
 * which runs wasm-pack over rust/graphql-cache/cache-wasm into
 * packages/graphql-cache/wasm/ (gitignored).
 */

import type { ReadResult, WriteResult } from '../protocol';

export interface CacheEngine {
  readQuery(
    opId: string | undefined,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined
  ): Promise<ReadResult>;
  writeQuery(
    originOpId: string | undefined,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown
  ): Promise<WriteResult>;
  invalidateKeys(keys: string[]): Promise<string[]>;
  teardownOperation(opId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CacheWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  openCache(scope: string, hotCapacity?: number): Promise<CacheEngine>;
  destroyCache(scope: string): Promise<void>;
  schemaHash(): string;
}

let modulePromise: Promise<CacheWasmModule> | undefined;

/** Loads and initializes the wasm module exactly once per worker context. */
export function loadCacheWasm(): Promise<CacheWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL('../wasm/cache_wasm.js', import.meta.url).href;
      const mod = (await import(/* @vite-ignore */ url)) as CacheWasmModule;
      await mod.default();
      return mod;
    })();
  }
  return modulePromise;
}
