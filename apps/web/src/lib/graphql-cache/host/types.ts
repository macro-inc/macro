/**
 * Transport-agnostic cache host interface consumed by the urql exchange and
 * imperative writers (websocket handlers). Implementations:
 * - worker-host.ts: browser (SharedWorker + wasm engine, or no-op fallback)
 * - tauri-host.ts (Phase 3b): Tauri IPC to the native engine
 */

import type {
  CachedQueryInstanceWire,
  ClaimedMutation,
  MutationClaim,
  OptimisticLinkPatchWire,
  OptimisticWriteResult,
  QueryRevalidationWire,
  ReadResult,
  WriteResult,
} from '../protocol';

export interface CacheReadArgs {
  /** urql operation key; registers the op for re-execution when set. */
  opKey?: number;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

export interface InspectQueryArgs {
  query: string;
  operationName?: string;
  /** Response-key field path from the query root. */
  path: Array<{ field: string }>;
}

export interface CacheWriteArgs extends CacheReadArgs {
  data: unknown;
  /** Opaque session tag; see protocol.ts `identity`. */
  identity?: string;
}

export interface BeginOptimisticWriteArgs extends CacheWriteArgs {
  linkPatches?: OptimisticLinkPatchWire[];
  /** Revalidations for relevant cached fields that could not be patched. */
  revalidations?: QueryRevalidationWire[];
}

export interface CacheHost {
  /** Stable id of this context; used to namespace operation ids. */
  readonly clientId: string;
  /** True for the storage-free fallback used without SharedWorker support. */
  readonly disabled?: boolean;

  readQuery(args: CacheReadArgs): Promise<ReadResult>;
  writeQuery(args: CacheWriteArgs): Promise<WriteResult>;
  /** Durably queues a mutation and its optimistic response. */
  beginOptimisticWrite(
    args: BeginOptimisticWriteArgs
  ): Promise<OptimisticWriteResult>;
  /** Enumerates cached variants of one generated query field selection. */
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
    claim: MutationClaim
  ): Promise<WriteResult>;
  /** Evict records by entity key (external/push updates); returns affected local op ids. */
  invalidate(keys: string[]): Promise<string[]>;
  /** urql teardown for an operation key. */
  teardown(opKey: number): Promise<void>;
  /** Wipe all cached state (logout). */
  clear(): Promise<void>;

  /**
   * Subscribes to "these urql operation keys must re-execute" pushes
   * (local writes from other operations, other tabs, push invalidation).
   * Only keys belonging to this client are delivered. Returns unsubscribe.
   */
  onOpsAffected(cb: (opKeys: number[]) => void): () => void;

  dispose(): void;
}
