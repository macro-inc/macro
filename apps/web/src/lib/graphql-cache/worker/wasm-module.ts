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
  CalendarCommitArgs,
  CalendarRangeCacheArgs,
  CalendarRangeCacheResult,
  ChannelTimelineCacheArgs,
  ChannelTimelineCacheResult,
  ChannelTimelineCommitArgs,
  ChannelTimelineEvictArgs,
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
import { compileCacheWasm } from './wasm-compile';

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

/** What `checkpointIfDue` did; frame counts are far below 2^53. */
export type CacheWalCheckpoint = {
  ran: boolean;
  walFrames: number;
  backfilledFrames: number;
};

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
    /** A write committed between `prepareHydrate` and `commitHydrate`. */
    projectionsReread?: true;
  };

export interface CacheEngine {
  currentAuthority(
    identity: string
  ): Promise<import('../authority').CacheAuthority>;
  transitionAuthority(
    identity: string,
    expected: string,
    policy: string
  ): Promise<import('../authority').AuthorityTransition>;

  currentRevision(): Promise<CacheRevision>;
  currentStorageGeneration(): Promise<string>;
  boundIdentity(): Promise<string | null>;
  /** Optional for compatibility engines; absence means unavailable. */
  queueDiagnostics?(): Promise<CacheQueueDiagnostics>;
  /** Optional for compatibility engines; absence leaves the checkpoint to COMMIT. */
  checkpointIfDue?(): Promise<CacheWalCheckpoint>;
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
  channelTimeline(
    request: ChannelTimelineCacheArgs
  ): Promise<ChannelTimelineCacheResult>;
  /** Resolves like `writeQuery`, plus the channel's sequence after the commit. */
  channelTimelineCommit(
    commit: ChannelTimelineCommitArgs
  ): Promise<WriteResult & { channelSeq: string | null }>;
  channelTimelineEvict(
    eviction: ChannelTimelineEvictArgs
  ): Promise<WriteResult & { channelIds: string[]; hasMore: boolean }>;
  channelTimelineStats(): Promise<{ channels: number; entries: number }>;
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
  /**
   * `hydrateQuery` in two halves: `prepareHydrate` reads what the response
   * changes and writes nothing, `commitHydrate` writes it. Between them the
   * worker runs only requests that read. Optional for compatibility engines.
   */
  prepareHydrate?(
    query: string,
    operationName: string | undefined,
    variables: Record<string, unknown> | undefined,
    data: unknown,
    identity: string | undefined,
    hydrationScope?: HydrationScope
  ): Promise<void>;
  /**
   * Optional, after `prepareHydrate`: runs the kept hydrate's next projection
   * pass without writing, and resolves whether one ran. Reads may run after
   * each; `stageHydrate` and `commitHydrate` run the passes left.
   */
  stepHydrate?(): Promise<boolean>;
  /**
   * Optional, between the halves: computes the kept hydrate's write without
   * writing, so `commitHydrate` only writes. Reads may run before and after.
   * Rejects when staging fails, keeping nothing to commit: the hydrate fails
   * with that error.
   */
  stageHydrate?(): Promise<void>;
  commitHydrate?(): Promise<CacheEngineHydrationResult>;
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
    clientMetadata: Record<string, unknown> | undefined,
    uncertainCalendarEventKeys: string[] | undefined,
    generation: string | undefined
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
    data: unknown,
    generation: string | undefined
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
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
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
  schemaHash(): string;
  /** Read-only binary metadata; optional so fixtures can diagnose stale artifacts. */
  cacheBuildInfo?(): unknown;
}

let modulePromise: Promise<CacheWasmModule> | undefined;
let compiledEngineExchange: CompiledEngineExchange | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

/** Returns the combined module's current unshared linear-memory allocation. */
type EngineExports = { memory?: WebAssembly.Memory };

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
    const initialization = (async () => {
      const telemetry = workerCacheTelemetry();
      const now = (): number => globalThis.performance?.now() ?? Date.now();
      const url = new URL('../wasm/cache_wasm.js', import.meta.url).href;
      const mod = (await import(/* @vite-ignore */ url)) as CacheWasmModule;
      // Resolve the wasm binary explicitly: vite copies the generated JS as
      // an opaque asset, so its internal relative `cache_wasm_bg.wasm` URL
      // would 404 in production. This `new URL` pattern is statically
      // analyzable, so vite emits exactly one lazy hashed binary. Explicit
      // fetch/compile keeps download, compile, and instantiate observable.
      const wasmUrl = new URL('../wasm/cache_wasm_bg.wasm', import.meta.url);
      const start = (compiled: WebAssembly.Module): Promise<EngineExports> =>
        mod.default({ module_or_path: compiled }) as Promise<EngineExports>;

      const finish = async (
        started: Promise<EngineExports>,
        instantiateStartedAt: number
      ): Promise<CacheWasmModule> => {
        try {
          const exports = await started;
          if (!(exports.memory instanceof WebAssembly.Memory)) {
            throw new Error('cache WASM did not export its linear memory');
          }
          wasmMemory = exports.memory;
          mod.setSlowQueryCallback?.(
            (queryFingerprint, durationMs, success) => {
              telemetry.record({
                name: 'graphql_cache.slow_query',
                operationCategory: 'storage',
                queryFingerprint,
                durationMs,
                outcome: success ? 'success' : 'error',
              });
            }
          );
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
      };

      // A module the owner page kept from an earlier engine worker skips
      // the download and arrives with its functions already compiled. It
      // only counts for the asset this worker would have loaded itself, and
      // not under the dev server, whose asset URL survives a rebuilt engine.
      const reuseStartedAt = now();
      const offered = import.meta.env.DEV
        ? undefined
        : await compiledEngineExchange?.offered;
      // The wait for the page, apart from instantiating what it offered.
      const offeredAt = now();
      if (offered?.assetUrl === wasmUrl.href) {
        let started: EngineExports | undefined;
        try {
          started = await start(offered.module);
        } catch {
          // The engine could not start from it: load it the ordinary way.
        }
        if (started) {
          // Nothing was downloaded or compiled; traces tell reuse by this.
          // Its duration is the wait for the page's offer.
          telemetry.record({
            name: 'graphql_cache.wasm_download',
            operationCategory: 'initialization',
            outcome: 'success',
            errorCode: 'none',
            durationMs: offeredAt - reuseStartedAt,
            bytes: 0,
          });
          // Past this point a failure would repeat with a fresh copy of
          // the same asset, so it is reported rather than retried.
          return finish(Promise.resolve(started), offeredAt);
        }
      }

      const compiled = await compileCacheWasm(wasmUrl, telemetry, now);
      compiledEngineExchange?.report({
        assetUrl: wasmUrl.href,
        module: compiled,
      });
      return finish(start(compiled), now());
    })();
    modulePromise = initialization;
    void initialization.catch(() => {
      if (modulePromise === initialization) modulePromise = undefined;
    });
  }
  return modulePromise;
}
