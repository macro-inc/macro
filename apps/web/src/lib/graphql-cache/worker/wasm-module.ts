import type {
  ContactReconcile,
  ContactSnapshot,
  ContactSnapshotRequest,
  PeopleContextState,
  PeopleContextUpdate,
  PeopleReferenceRequest,
  PeopleReferenceResult,
  PeopleScope,
  PeopleSearch,
  PeopleSearchResult,
  PeopleSqlRequest,
  PeopleSqlResult,
} from '../people/generated';
import type { IdentityBindingWire, MutationInspection } from '../protocol';

/**
 * The `cache-wasm` module with its values typed: the generated declarations
 * type them `any`. The optional members cover compatibility engines.
 */

import cacheWasm from 'wasm:cache-wasm';
import type { WasmLoadPhase } from '@core/wasm/define-wasm-module';
import type { EntityResolverWire } from '../exchange/entity-resolvers';
import type {
  AffectedOperationsResult,
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CacheRevision,
  CacheRevisionResult,
  CalendarCommitArgs,
  CalendarRangeCacheArgs,
  CalendarRangeCacheResult,
  ClaimedMutation,
  CommitOptimisticWriteResult,
  DeferOptimisticWriteResult,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
  HydrationScope,
  HydrationSearchChanges,
  OptimisticLinkPatchWire,
  QueryRevalidationWire,
  ReadRecordsByKeysResult,
  ReadResult,
  RollbackOptimisticWriteResult,
  SearchCacheArgs,
  SearchCachePage,
  WriteResult,
} from '../protocol';
import { workerCacheTelemetry } from '../telemetry-relay';
import type { CompiledEngineExchange } from './compiled-engine';
import type { StaleDatabaseRemovalOutcome } from './stale-databases';

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

export type CacheEngineHydrationResult = WriteResult &
  HydrationSearchChanges & {
    data: unknown | null;
  };

export interface CacheEngine {
  currentRevision(): Promise<CacheRevision>;
  currentStorageGeneration(): Promise<string>;
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
  watchQuery?(
    opId: string,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    entityResolvers: readonly EntityResolverWire[] | undefined,
    since: string | undefined
  ): Promise<import('../protocol').QueryUpdate>;
  readRecordsByKeys(
    document: string,
    fragmentName: string,
    keys: string[]
  ): Promise<ReadRecordsByKeysResult>;
  search(
    request: SearchCacheArgs & { nowMs: number }
  ): Promise<SearchCachePage>;
  contactSnapshot?(request: ContactSnapshotRequest): Promise<ContactSnapshot>;
  contactReconcile?(request: ContactReconcile): Promise<WriteResult>;
  peopleReadSql?(request: PeopleSqlRequest): Promise<PeopleSqlResult>;
  peopleResolveReferences?(
    request: PeopleReferenceRequest
  ): Promise<PeopleReferenceResult>;
  peopleContext?(scope: PeopleScope): Promise<PeopleContextState>;
  peopleUpdate?(update: PeopleContextUpdate): Promise<WriteResult>;
  peopleSearch?(request: PeopleSearch): Promise<PeopleSearchResult>;
  entityFilter(
    request: EntityFilterCacheArgs
  ): Promise<EntityFilterCacheResult>;
  calendarRange(
    request: CalendarRangeCacheArgs
  ): Promise<CalendarRangeCacheResult>;
  /** Resolves like `writeQuery`: deleted records are reported as `changed`. */
  calendarCommit(commit: CalendarCommitArgs): Promise<WriteResult>;
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
    identity: string | undefined,
    hydrationScope?: HydrationScope
  ): Promise<CacheEngineHydrationResult>;
  inspectMutations(): Promise<MutationInspection[]>;
  enqueueOptimisticMutation(
    originOpId: string | undefined,
    uuid: string,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown,
    linkPatches: OptimisticLinkPatchWire[] | undefined,
    revalidations: QueryRevalidationWire[] | undefined,
    identityBindings: IdentityBindingWire[] | undefined,
    createdAtMs: number,
    leaseOwner: string,
    nowMs: number,
    leaseExpiresAtMs: number,
    clientMetadata?: Record<string, unknown>,
    uncertainCalendarEventKeys?: string[]
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
    error: string,
    serverFailure: boolean
  ): Promise<DeferOptimisticWriteResult>;
  commitOptimisticWrite(
    transactionId: string,
    leaseOwner: string,
    leaseGeneration: string,
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown
  ): Promise<CommitOptimisticWriteResult>;
  rollbackOptimisticWrite(
    transactionId: string,
    leaseOwner: string,
    leaseGeneration: string
  ): Promise<RollbackOptimisticWriteResult>;
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
  openCache(scope: string, hotCapacity?: number): Promise<CacheEngine>;
  /**
   * Additive open API with a coarse, payload-free recovery outcome. When
   * given, `onOwnerLockAcquired` runs after the owner lock is held and before
   * any OPFS access; opening continues once its promise resolves. With
   * `ifAvailable`, a held owner lock rejects at once, touching nothing, with an
   * error whose `cacheOwnerLockUnavailable` property is `true`. Files another
   * context keeps open through a bounded wait reject with an error whose
   * `cacheStorageBusy` property is `true`; a plain open has then changed
   * neither file.
   */
  openCacheWithOutcome?(
    scope: string,
    hotCapacity?: number,
    onOwnerLockAcquired?: () => Promise<void>,
    ifAvailable?: boolean
  ): Promise<CacheOpenResult>;
  /** Atomically wipes before Turso open while retaining one OPFS owner lock. */
  openCacheForRecovery(
    scope: string,
    hotCapacity?: number
  ): Promise<CacheEngine>;
  /** Additive recovery-open API with its coarse wipe outcome; see above for
   * `onOwnerLockAcquired` and `ifAvailable`, which precede the recovery wipe. */
  openCacheForRecoveryWithOutcome?(
    scope: string,
    hotCapacity?: number,
    onOwnerLockAcquired?: () => Promise<void>,
    ifAvailable?: boolean
  ): Promise<CacheOpenResult>;
  destroyCache(scope: string): Promise<void>;
  /** Physical database this build opens for `scope`; absent before databases
   * were named by storage version. */
  cacheDatabaseIdentity?(scope: string): string;
  /** Deletes one stale database of `scope` if unused and without queued
   * mutations; see `staleCacheDatabaseIdentities`. */
  removeStaleCacheDatabase?(
    scope: string,
    identity: string
  ): Promise<StaleDatabaseRemovalOutcome>;
  /** Optional while older cached WASM artifacts are still in circulation. */
  setSlowQueryCallback?(
    callback: (
      fingerprint: string,
      durationMs: number,
      success: boolean
    ) => void
  ): void;
  /** Installs the schema shipped with this frontend before opening storage. */
  configureCacheSchema(schemaSdl: string): void;
  schemaHash(): string;
  /** Read-only binary metadata; optional so fixtures can diagnose stale artifacts. */
  cacheBuildInfo?(): unknown;
}

let modulePromise: Promise<CacheWasmModule> | undefined;
let compiledEngineExchange: CompiledEngineExchange | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** Set before the first load; the worker then reuses and reports through it. */
export function setCompiledEngineExchange(
  exchange: CompiledEngineExchange
): void {
  compiledEngineExchange = exchange;
}

export function cacheWasmLinearMemoryBytes(): number {
  if (!wasmMemory) throw new Error('cache WASM memory is not initialized');
  return wasmMemory.buffer.byteLength;
}

/** Loads and initializes the wasm module exactly once per worker context. */
export function loadCacheWasm(): Promise<CacheWasmModule> {
  if (!modulePromise) {
    // Nothing replaces `modulePromise` while it is in flight.
    modulePromise = (async () => {
      try {
        return await initialize();
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}

async function initialize(): Promise<CacheWasmModule> {
  const telemetry = workerCacheTelemetry();
  const now = (): number => globalThis.performance?.now() ?? Date.now();
  // The key the owner page keeps a compiled module under.
  const assetUrl = new URL(cacheWasm.binaryUrl, globalThis.location.href).href;

  // Configures a started instance; reported with its start as one
  // instantiate phase.
  const configure = async (
    mod: CacheWasmModule,
    instantiateStartedAt: number
  ): Promise<CacheWasmModule> => {
    try {
      const memory = cacheWasm.memory();
      if (!memory) {
        throw new Error('cache WASM did not export its linear memory');
      }
      const { default: schemaSdl } = await import(
        '../../../../../../static_assets/schema.graphql?raw'
      );
      mod.configureCacheSchema(schemaSdl);
      wasmMemory = memory;
      mod.setSlowQueryCallback?.((queryFingerprint, durationMs, success) => {
        telemetry.record({
          name: 'graphql_cache.slow_query',
          operationCategory: 'storage',
          queryFingerprint,
          durationMs,
          outcome: success ? 'success' : 'error',
        });
      });
      telemetry.record({
        name: 'graphql_cache.wasm_instantiate',
        operationCategory: 'initialization',
        outcome: 'success',
        errorCode: 'none',
        durationMs: now() - instantiateStartedAt,
      });
      return mod;
    } catch (error) {
      instantiateFailed(instantiateStartedAt);
      throw error;
    }
  };

  const instantiateFailed = (instantiateStartedAt: number) => {
    telemetry.record({
      name: 'graphql_cache.wasm_instantiate',
      operationCategory: 'initialization',
      outcome: 'error',
      errorCode: 'wasm-instantiate',
      durationMs: now() - instantiateStartedAt,
    });
  };

  // A module the owner page kept from an earlier engine worker skips the
  // download and arrives with its functions already compiled. It only counts
  // for the asset this worker would have loaded itself, and not under the dev
  // server, whose asset URL survives a rebuilt engine.
  const reuseStartedAt = now();
  const offered = import.meta.env.DEV
    ? undefined
    : await compiledEngineExchange?.offered;
  if (offered?.assetUrl === assetUrl) {
    let started: CacheWasmModule | undefined;
    try {
      started = await cacheWasm.load({ module: offered.module });
    } catch {
      // The engine could not start from it: load it the ordinary way.
    }
    if (started) {
      // Nothing was downloaded or compiled; traces tell reuse by this.
      telemetry.record({
        name: 'graphql_cache.wasm_download',
        operationCategory: 'initialization',
        outcome: 'success',
        errorCode: 'none',
        durationMs: now() - reuseStartedAt,
        bytes: 0,
      });
      // Past this point a failure would repeat with a fresh copy of the
      // same asset, so it is reported rather than retried.
      return configure(started, reuseStartedAt);
    }
  }

  const compiled = await cacheWasm.compiled({
    onPhase: (phase) => telemetry.record(loadObservation(phase)),
  });
  compiledEngineExchange?.report({ assetUrl, module: compiled });
  const instantiateStartedAt = now();
  let started: CacheWasmModule;
  try {
    // Checked against the generated declarations.
    started = await cacheWasm.load({ module: compiled });
  } catch (error) {
    instantiateFailed(instantiateStartedAt);
    throw error;
  }
  return configure(started, instantiateStartedAt);
}

/** A shared-loader phase as the cache's own load observation. */
function loadObservation(phase: WasmLoadPhase) {
  const succeeded = phase.outcome === 'success';
  if (phase.phase === 'download') {
    return {
      name: 'graphql_cache.wasm_download' as const,
      operationCategory: 'initialization' as const,
      outcome: phase.outcome,
      errorCode: succeeded ? ('none' as const) : ('wasm-download' as const),
      durationMs: phase.durationMs,
      ...(phase.bytes === undefined ? {} : { bytes: phase.bytes }),
    };
  }
  return {
    name: 'graphql_cache.wasm_compile' as const,
    operationCategory: 'initialization' as const,
    outcome: phase.outcome,
    errorCode: succeeded ? ('none' as const) : ('wasm-compile' as const),
    durationMs: phase.durationMs,
  };
}
