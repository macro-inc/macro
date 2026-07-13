/**
 * Typed surface of the generated wasm package (`cache-wasm`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-cache-wasm
 * which runs wasm-pack over crates/client/cache-wasm into
 * src/lib/graphql-cache/wasm/ (gitignored).
 */

import type {
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from '../protocol';

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
    data: unknown,
    identity: string | undefined
  ): Promise<WriteResult>;
  beginOptimisticWrite(
    originOpId: string | undefined,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown
  ): Promise<OptimisticWriteResult>;
  commitOptimisticWrite(
    transactionId: string,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown
  ): Promise<WriteResult>;
  rollbackOptimisticWrite(transactionId: string): Promise<WriteResult>;
  invalidateKeys(keys: string[]): Promise<string[]>;
  externalReset(): Promise<string[]>;
  teardownOperation(opId: string): Promise<void>;
  clear(): Promise<void>;
  /** Close the IndexedDB connection; call before destroyCache. */
  close(): Promise<void>;
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
      // Resolve the wasm binary explicitly: vite copies the generated JS as
      // an opaque asset, so its internal relative `cache_wasm_bg.wasm` URL
      // would 404 in production. This `new URL` pattern is statically
      // analyzable, so vite emits the binary as an asset and rewrites it.
      const wasmUrl = new URL('../wasm/cache_wasm_bg.wasm', import.meta.url);
      await mod.default({ module_or_path: wasmUrl });
      return mod;
    })();
  }
  return modulePromise;
}
