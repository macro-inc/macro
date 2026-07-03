/**
 * Transport-agnostic cache host interface consumed by the urql exchange and
 * imperative writers (websocket handlers). Implementations:
 * - worker-host.ts: browser (SharedWorker / dedicated worker + wasm engine)
 * - tauri-host.ts (Phase 3b): Tauri IPC to the native engine
 */

import type { ReadResult, WriteResult } from '../protocol';

export interface CacheReadArgs {
  /** urql operation key; registers the op for re-execution when set. */
  opKey?: number;
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

export interface CacheWriteArgs extends CacheReadArgs {
  data: unknown;
}

export interface CacheHost {
  /** Stable id of this context; used to namespace operation ids. */
  readonly clientId: string;

  readQuery(args: CacheReadArgs): Promise<ReadResult>;
  writeQuery(args: CacheWriteArgs): Promise<WriteResult>;
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
