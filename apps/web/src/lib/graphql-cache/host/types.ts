/**
 * Transport-agnostic cache host interface consumed by the urql exchange and
 * imperative writers (websocket handlers). Implementations:
 * - worker-host.ts: browser (SharedWorker coordinator + elected WASM engine,
 *   or no-op fallback)
 * - tauri-host.ts (Phase 3b): Tauri IPC to the native engine
 */

import type { EntityResolverWire } from '../exchange/entity-resolvers';
import type {
  AffectedOperationsResult,
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CacheReadPriority,
  CacheRevision,
  ClaimedMutation,
  EnqueueOptimisticMutationResult,
  EntityFilterCacheArgs,
  EntityFilterCacheResult,
  HydrationResult,
  MutationClaim,
  MutationSettlement,
  OptimisticLinkPatchWire,
  QueryRevalidationWire,
  QueryVariableFilter,
  ReadRecordsByKeysArgs,
  ReadRecordsByKeysResult,
  ReadResult,
  SearchCacheArgs,
  SearchCachePage,
  WriteResult,
} from '../protocol';

export interface CacheReadArgs {
  /** urql operation key; registers the op for re-execution when set. */
  opKey?: number;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  /** Prioritizes a pushed, user-visible refresh over incidental reads. */
  priority?: CacheReadPriority;
  /** Read-only synthetic entity relations compiled by the exchange. */
  entityResolvers?: readonly EntityResolverWire[];
}

export interface InspectQueryArgs {
  query: string;
  operationName?: string;
  /** Response-key field path from the query root. */
  path: Array<{ field: string }>;
  /** OR-ed recursive partial matches applied before result materialization. */
  variableFilters?: QueryVariableFilter[];
}

/** Variables-only inspection always discovers every cached variant. */
export type InspectQueryVariantsArgs = Omit<
  InspectQueryArgs,
  'variableFilters'
>;

export interface CacheWriteArgs extends Omit<CacheReadArgs, 'priority'> {
  data: unknown;
  /** Installs this active query's dependencies from the normalized response. */
  registerDependencies?: boolean;
  /** Opaque session tag; see protocol.ts `identity`. */
  identity?: string;
}

export interface EnqueueOptimisticMutationArgs extends CacheWriteArgs {
  linkPatches?: OptimisticLinkPatchWire[];
  /** Revalidations for relevant cached fields that could not be patched. */
  revalidations?: QueryRevalidationWire[];
}

/** Lease request used for the claim attempted immediately after enqueue. */
export interface InitialMutationClaimArgs {
  owner: string;
  nowMs: number;
  leaseExpiresAtMs: number;
}

export interface CacheHost {
  /** Stable id of this context; used to namespace operation ids. */
  readonly clientId: string;
  /** True for the storage-free fallback when browser cache APIs are unsupported. */
  readonly disabled?: boolean;

  /** Returns the current revision of the active cache-engine generation. */
  currentRevision(): Promise<CacheRevision>;
  readQuery(args: CacheReadArgs): Promise<ReadResult>;
  /** Projects a bounded explicit set of normalized entity keys. */
  readRecordsByKeys(
    args: ReadRecordsByKeysArgs
  ): Promise<ReadRecordsByKeysResult>;
  /** Searches the compact write-through materialized projection. */
  search(args: SearchCacheArgs): Promise<SearchCachePage>;
  /** Evaluates an exact initial Soup filter page over complete local projections. */
  entityFilter(args: EntityFilterCacheArgs): Promise<EntityFilterCacheResult>;
  writeQuery(args: CacheWriteArgs): Promise<WriteResult>;
  /** Stores a query response and returns only fields not marked `@cacheOnly`. */
  hydrateQuery(args: Omit<CacheWriteArgs, 'opKey'>): Promise<HydrationResult>;
  /** Durably queues an optimistic mutation and claims the strict head. */
  enqueueOptimisticMutation(
    args: EnqueueOptimisticMutationArgs,
    claim: InitialMutationClaimArgs
  ): Promise<EnqueueOptimisticMutationResult>;
  /** Recovers variables for cached variants without materializing values. */
  inspectQueryVariants(
    args: InspectQueryVariantsArgs
  ): Promise<CachedQueryVariantWire[]>;
  /** Enumerates and materializes cached query field variants. */
  inspectQuery(args: InspectQueryArgs): Promise<CachedQueryInstanceWire[]>;
  /** Claims the oldest runnable mutation; later entries are never skipped. */
  claimNextMutation(
    owner: string,
    nowMs: number,
    leaseExpiresAtMs: number
  ): Promise<ClaimedMutation | undefined>;
  /** Retains a retryable mutation and releases its lease. */
  deferOptimisticWrite(
    transactionId: string,
    claim: MutationClaim,
    nextAttemptAtMs: number,
    error: string
  ): Promise<void>;
  /** Atomically commits a claimed mutation's real network response. */
  commitOptimisticWrite(
    transactionId: string,
    claim: MutationClaim,
    args: CacheWriteArgs
  ): Promise<WriteResult>;
  /** Permanently fails a claimed mutation and drops its optimistic layer. */
  rollbackOptimisticWrite(
    transactionId: string,
    claim: MutationClaim,
    error: string
  ): Promise<WriteResult>;
  /** Evict records by entity key (external/push updates); returns affected local op ids. */
  invalidate(keys: string[]): Promise<AffectedOperationsResult>;
  /** Apply explicit server-provided cache-deletion effects. */
  deleteRecords(keys: string[]): Promise<AffectedOperationsResult>;
  /** urql teardown for an operation key. */
  teardown(opKey: number): Promise<void>;
  /** Wipe all cached state (logout). */
  clear(): Promise<CacheRevision>;

  /**
   * Subscribes to "these urql operation keys must re-execute" pushes
   * (local writes from other operations, other tabs, push invalidation).
   * Only keys belonging to this client are delivered. Returns unsubscribe.
   */
  onOpsAffected(cb: (opKeys: number[]) => void): () => void;

  /** Subscribes whenever the effective normalized-cache view changes. */
  onCacheChanged(cb: (revision: CacheRevision) => void): () => void;

  /** Invalidates revision watermarks before a replacement engine is used. */
  onCacheGenerationChanged(cb: () => void): () => void;

  /** Subscribes to final commit/rollback events for queued mutations. */
  onMutationSettled(cb: (settlement: MutationSettlement) => void): () => void;

  dispose(): void;
}
