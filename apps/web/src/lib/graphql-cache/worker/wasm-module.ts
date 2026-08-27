/**
 * Typed surface of the generated wasm package (`cache-wasm`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-cache-wasm
 * which runs wasm-pack over crates/client/cache-wasm into
 * src/lib/graphql-cache/wasm/ (gitignored).
 */

import type { EntityResolverWire } from '../exchange/entity-resolvers';
import type {
  AffectedOperationsResult,
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CacheRevision,
  CacheRevisionResult,
  ClaimedMutation,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
  OptimisticLinkPatchWire,
  QueryRevalidationWire,
  ReadRecordsByKeysResult,
  ReadResult,
  SearchCacheArgs,
  SearchCachePage,
  WriteResult,
} from '../protocol';
import { workerCacheTelemetry } from '../telemetry-relay';

/** Stable, payload-free marker latched on reset-required WASM errors. */
export interface CacheStorageResetRequiredError extends Error {
  readonly cacheStorageResetRequired: true;
}

export type CacheOpenOutcome =
  | 'opened-existing'
  | 'opened-new'
  | 'reset-incompatible'
  | 'reset-corrupt'
  | 'reset-storage-uncertain';

export type CacheQueueDiagnostics =
  | {
      availability: 'available';
      /** Decimal strings preserve Rust integer precision across wasm-bindgen. */
      depth: string;
      oldestCreatedAtMs: string | null;
    }
  | {
      /** Compatibility engines must never masquerade as an empty queue. */
      availability: 'unavailable';
      depth: null;
      oldestCreatedAtMs: null;
    };

export interface CacheOpenResult {
  engine: CacheEngine;
  outcome: CacheOpenOutcome;
}

export type CacheEngineHydrationResult = WriteResult & {
  data: unknown | null;
};

export interface CacheEngine {
  currentRevision(): Promise<CacheRevision>;
  boundIdentity(): Promise<string | null>;
  /** Optional for compatibility engines; absence means unavailable. */
  queueDiagnostics?(): Promise<CacheQueueDiagnostics>;
  readQuery(
    opId: string | undefined,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    entityResolvers: readonly EntityResolverWire[] | undefined
  ): Promise<ReadResult>;
  readRecordsByKeys(
    document: string,
    fragmentName: string,
    keys: string[]
  ): Promise<ReadRecordsByKeysResult>;
  search(
    request: SearchCacheArgs & { nowMs: number }
  ): Promise<SearchCachePage>;
  entityFilter(
    request: EntityFilterCacheArgs
  ): Promise<EntityFilterCacheResult>;
  writeQuery(
    context: {
      originOpId?: string;
      registration?: {
        opId: string;
        entityResolvers?: readonly EntityResolverWire[];
      };
    },
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown,
    identity: string | undefined
  ): Promise<WriteResult>;
  hydrateQuery(
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown,
    identity: string | undefined
  ): Promise<CacheEngineHydrationResult>;
  enqueueOptimisticMutation(
    originOpId: string | undefined,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown,
    linkPatches: OptimisticLinkPatchWire[] | undefined,
    revalidations: QueryRevalidationWire[] | undefined,
    createdAtMs: number,
    leaseOwner: string,
    nowMs: number,
    leaseExpiresAtMs: number
  ): Promise<EnqueueOptimisticMutationResult>;
  inspectQueryVariants(
    query: string,
    operationName: string | undefined,
    path: Array<{ field: string }>
  ): Promise<CachedQueryVariantWire[]>;
  inspectQuery(
    query: string,
    operationName: string | undefined,
    path: Array<{ field: string }>,
    variableFilters: Array<Record<string, unknown>>
  ): Promise<CachedQueryInstanceWire[]>;
  claimNextMutation(
    owner: string,
    nowMs: number,
    leaseExpiresAtMs: number
  ): Promise<ClaimedMutation | undefined>;
  deferOptimisticWrite(
    transactionId: string,
    leaseOwner: string,
    leaseGeneration: string,
    nextAttemptAtMs: number,
    error: string
  ): Promise<void>;
  commitOptimisticWrite(
    transactionId: string,
    leaseOwner: string,
    leaseGeneration: string,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown
  ): Promise<WriteResult>;
  rollbackOptimisticWrite(
    transactionId: string,
    leaseOwner: string,
    leaseGeneration: string
  ): Promise<WriteResult>;
  invalidateKeys(keys: string[]): Promise<AffectedOperationsResult>;
  deleteKeys(keys: string[]): Promise<AffectedOperationsResult>;
  teardownOperation(opId: string): Promise<void>;
  clear(): Promise<CacheRevisionResult>;
  /** Reset/recreate OPFS; concurrent calls wait for the fresh engine. */
  physicalReset(): Promise<void>;
  /** Gracefully close Turso/OPFS and release the owner lock. */
  close(): Promise<void>;
}

export interface CacheWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  openCache(scope: string, hotCapacity?: number): Promise<CacheEngine>;
  /** Additive open API with a coarse, payload-free recovery outcome. */
  openCacheWithOutcome?(
    scope: string,
    hotCapacity?: number
  ): Promise<CacheOpenResult>;
  /** Atomically wipes before Turso open while retaining one OPFS owner lock. */
  openCacheForRecovery(
    scope: string,
    hotCapacity?: number
  ): Promise<CacheEngine>;
  /** Additive recovery-open API with its coarse wipe outcome. */
  openCacheForRecoveryWithOutcome?(
    scope: string,
    hotCapacity?: number
  ): Promise<CacheOpenResult>;
  destroyCache(scope: string): Promise<void>;
  schemaHash(): string;
}

let modulePromise: Promise<CacheWasmModule> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** Returns the combined module's current unshared linear-memory allocation. */
export function cacheWasmLinearMemoryBytes(): number {
  if (!wasmMemory) throw new Error('cache WASM memory is not initialized');
  return wasmMemory.buffer.byteLength;
}

/** Loads and initializes the wasm module exactly once per worker context. */
export function loadCacheWasm(): Promise<CacheWasmModule> {
  if (!modulePromise) {
    const initialization = (async () => {
      const telemetry = workerCacheTelemetry();
      const now = (): number => globalThis.performance?.now() ?? Date.now();
      const url = new URL('../wasm/cache_wasm.js', import.meta.url).href;
      const mod = (await import(/* @vite-ignore */ url)) as CacheWasmModule;
      // Resolve the wasm binary explicitly: vite copies the generated JS as
      // an opaque asset, so its internal relative `cache_wasm_bg.wasm` URL
      // would 404 in production. This `new URL` pattern is statically
      // analyzable, so vite emits exactly one lazy hashed binary. Explicit
      // fetch/compile keeps download, compile, and instantiate separately observable.
      const wasmUrl = new URL('../wasm/cache_wasm_bg.wasm', import.meta.url);
      const downloadStartedAt = now();
      let bytes: ArrayBuffer;
      try {
        const response = await fetch(wasmUrl);
        if (!response.ok) {
          throw new Error(
            `cache WASM download returned HTTP ${response.status}`
          );
        }
        bytes = await response.arrayBuffer();
        telemetry.record({
          name: 'graphql_cache.wasm_download',
          operationCategory: 'initialization',
          outcome: 'success',
          errorCode: 'none',
          durationMs: now() - downloadStartedAt,
          bytes: bytes.byteLength,
        });
      } catch (error) {
        telemetry.record({
          name: 'graphql_cache.wasm_download',
          operationCategory: 'initialization',
          outcome: 'error',
          errorCode: 'wasm-download',
          durationMs: now() - downloadStartedAt,
        });
        throw error;
      }

      const compileStartedAt = now();
      let compiled: WebAssembly.Module;
      try {
        compiled = await WebAssembly.compile(bytes);
        telemetry.record({
          name: 'graphql_cache.wasm_compile',
          operationCategory: 'initialization',
          outcome: 'success',
          errorCode: 'none',
          durationMs: now() - compileStartedAt,
        });
      } catch (error) {
        telemetry.record({
          name: 'graphql_cache.wasm_compile',
          operationCategory: 'initialization',
          outcome: 'error',
          errorCode: 'wasm-compile',
          durationMs: now() - compileStartedAt,
        });
        throw error;
      }

      const instantiateStartedAt = now();
      try {
        const exports = (await mod.default({ module_or_path: compiled })) as {
          memory?: WebAssembly.Memory;
        };
        if (!(exports.memory instanceof WebAssembly.Memory)) {
          throw new Error('cache WASM did not export its linear memory');
        }
        wasmMemory = exports.memory;
        telemetry.record({
          name: 'graphql_cache.wasm_instantiate',
          operationCategory: 'initialization',
          outcome: 'success',
          errorCode: 'none',
          durationMs: now() - instantiateStartedAt,
        });
        return mod;
      } catch (error) {
        telemetry.record({
          name: 'graphql_cache.wasm_instantiate',
          operationCategory: 'initialization',
          outcome: 'error',
          errorCode: 'wasm-instantiate',
          durationMs: now() - instantiateStartedAt,
        });
        throw error;
      }
    })();
    modulePromise = initialization;
    void initialization.catch(() => {
      if (modulePromise === initialization) modulePromise = undefined;
    });
  }
  return modulePromise;
}
