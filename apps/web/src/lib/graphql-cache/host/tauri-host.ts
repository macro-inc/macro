/**
 * Tauri CacheHost: talks to the native cache engine living in the Tauri
 * host process (graphql_cache_plugin) over invoke commands. The host
 * process is the single shared engine instance across all webviews/windows
 * (SharedWorker semantics); change pushes arrive as a broadcast tauri event
 * that every webview filters by its own clientId prefix — mirroring
 * worker-host.ts.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AffectedOperationsResult,
  CachedQueryInstanceWire,
  CachedQueryVariantWire,
  CacheRevision,
  ClaimedMutation,
  EnqueueOptimisticMutationResult,
  HydrationResult,
  MutationClaim,
  MutationSettlement,
  ReadRecordsByKeysArgs,
  ReadRecordsByKeysResult,
  ReadResult,
  SearchCacheArgs,
  SearchCachePage,
  WriteResult,
} from '../protocol';
import {
  parseCacheRevision,
  validateCacheSearchArgs,
  validateRecordSelectionKeys,
} from '../protocol';
import type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
  EnqueueOptimisticMutationArgs,
  InitialMutationClaimArgs,
  InspectQueryArgs,
  InspectQueryVariantsArgs,
} from './types';

/** Keep in sync with `OPS_AFFECTED_EVENT` in graphql_cache_plugin. */
const OPS_AFFECTED_EVENT = 'graphql-cache://ops-affected';
/** Keep in sync with `CACHE_CHANGED_EVENT` in the native plugin. */
const CACHE_CHANGED_EVENT = 'graphql-cache://cache-changed';
/** Keep in sync with `MUTATION_SETTLED_EVENT` in graphql_cache_plugin. */
const MUTATION_SETTLED_EVENT = 'graphql-cache://mutation-settled';

/** Payload of the ops-affected event (graphql_cache_plugin `OpsAffectedEvent`). */
type OpsAffectedPayload = {
  opIds: string[];
  keys: string[];
};

type CacheChangedPayload = { revision: string };

export interface TauriHostOptions {
  scope: string;
  hotCapacity?: number;
  /**
   * Request timeout in ms (default 10s, matching worker-host). Applies to all
   * commands except optimistic enqueue, which remains pending because retrying
   * an uncertain durable operation could duplicate user intent.
   */
  requestTimeoutMs?: number;
  /** Reports an asynchronous durable-storage initialization failure. */
  onInitializationError?: (error: Error) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createTauriCacheHost(options: TauriHostOptions): CacheHost {
  const clientId = crypto.randomUUID();
  const affectedSubscribers = new Set<(opKeys: number[]) => void>();
  const cacheChangeSubscribers = new Set<(revision: CacheRevision) => void>();
  const settlementSubscribers = new Set<
    (settlement: MutationSettlement) => void
  >();
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  function request<T>(
    command: string,
    args: Record<string, unknown>,
    timeout = true
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            reject(new Error(`graphql cache ipc timeout: ${command}`));
          }, requestTimeoutMs)
        : undefined;
      invoke<T>(command, args).then(
        (value) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (timer !== undefined) clearTimeout(timer);
          // Command errors cross the boundary as strings; normalize to
          // Error for parity with worker-host rejections.
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  // Failure tolerated: reads/writes still work, only push-driven
  // re-execution is lost — same degradation as a broken worker port.
  const unlistenOps: Promise<UnlistenFn | undefined> =
    listen<OpsAffectedPayload>(OPS_AFFECTED_EVENT, (event) => {
      const prefix = `${clientId}:`;
      const opKeys = event.payload.opIds
        .filter((id) => id.startsWith(prefix))
        .map((id) => Number(id.slice(prefix.length)))
        .filter((n) => Number.isFinite(n));
      if (opKeys.length > 0) {
        for (const cb of affectedSubscribers) cb(opKeys);
      }
    }).catch((error) => {
      console.warn('graphql cache ops-affected listener failed', error);
      return undefined;
    });
  const unlistenSettlements: Promise<UnlistenFn | undefined> =
    listen<MutationSettlement>(MUTATION_SETTLED_EVENT, (event) => {
      for (const cb of settlementSubscribers) cb(event.payload);
    }).catch((error) => {
      console.warn('graphql cache mutation-settled listener failed', error);
      return undefined;
    });

  const unlistenCacheChanges: Promise<UnlistenFn | undefined> =
    listen<CacheChangedPayload>(CACHE_CHANGED_EVENT, (event) => {
      const revision = parseCacheRevision(event.payload.revision);
      for (const cb of cacheChangeSubscribers) cb(revision);
    }).catch((error) => {
      console.warn('graphql cache change listener failed', error);
      return undefined;
    });

  const ready = request<void>('graphql_cache_init', {
    scope: options.scope,
    hotCapacity: options.hotCapacity,
  });
  void (async () => {
    try {
      await ready;
    } catch (error) {
      options.onInitializationError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  })();

  const opId = (opKey: number) => `${clientId}:${opKey}`;

  return {
    clientId,

    async currentRevision(): Promise<CacheRevision> {
      await ready;
      return parseCacheRevision(
        await request<string>('graphql_cache_current_revision', {})
      );
    },

    async readQuery(args: CacheReadArgs): Promise<ReadResult> {
      await ready;
      return await request<ReadResult>('graphql_cache_read', {
        opId: args.opKey === undefined ? undefined : opId(args.opKey),
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        entityResolvers: args.entityResolvers,
      });
    },

    async readRecordsByKeys(
      args: ReadRecordsByKeysArgs
    ): Promise<ReadRecordsByKeysResult> {
      const keys = validateRecordSelectionKeys(args.keys);
      await ready;
      const result = await request<ReadRecordsByKeysResult>(
        'graphql_cache_read_records_by_keys',
        {
          document: args.document,
          fragmentName: args.fragmentName,
          keys,
        }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async search(args: SearchCacheArgs): Promise<SearchCachePage> {
      const searchRequest = validateCacheSearchArgs(args);
      await ready;
      return await request<SearchCachePage>('graphql_cache_search', {
        request: searchRequest,
      });
    },

    async entityFilter() {
      // The first profile is browser Turso/OPFS-only.
      return { kind: 'unsupported' };
    },

    async writeQuery(args: CacheWriteArgs): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>('graphql_cache_write', {
        originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
        registration:
          args.registerDependencies && args.opKey !== undefined
            ? {
                opId: opId(args.opKey),
                entityResolvers: args.entityResolvers,
              }
            : undefined,
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      });
    },

    async hydrateQuery(
      args: Omit<CacheWriteArgs, 'opKey'>
    ): Promise<HydrationResult> {
      await ready;
      return await request<HydrationResult>('graphql_cache_hydrate', {
        query: args.query,
        operationName: args.operationName,
        variables: args.variables,
        data: args.data,
        identity: args.identity,
      });
    },

    async enqueueOptimisticMutation(
      args: EnqueueOptimisticMutationArgs,
      claim: InitialMutationClaimArgs
    ): Promise<EnqueueOptimisticMutationResult> {
      await ready;
      return await request<EnqueueOptimisticMutationResult>(
        'graphql_cache_enqueue_optimistic_mutation',
        {
          originOpId: args.opKey === undefined ? undefined : opId(args.opKey),
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
          linkPatches: args.linkPatches,
          revalidations: args.revalidations,
          createdAtMs: claim.nowMs,
          owner: claim.owner,
          nowMs: claim.nowMs,
          leaseExpiresAtMs: claim.leaseExpiresAtMs,
        },
        false
      );
    },

    async inspectQueryVariants(
      args: InspectQueryVariantsArgs
    ): Promise<CachedQueryVariantWire[]> {
      await ready;
      return await request<CachedQueryVariantWire[]>(
        'graphql_cache_inspect_query_variants',
        {
          query: args.query,
          operationName: args.operationName,
          path: args.path,
        }
      );
    },

    async inspectQuery(
      args: InspectQueryArgs
    ): Promise<CachedQueryInstanceWire[]> {
      await ready;
      return await request<CachedQueryInstanceWire[]>(
        'graphql_cache_inspect_query',
        {
          query: args.query,
          operationName: args.operationName,
          path: args.path,
          variableFilters: args.variableFilters,
        }
      );
    },

    async claimNextMutation(
      owner: string,
      nowMs: number,
      leaseExpiresAtMs: number
    ): Promise<ClaimedMutation | undefined> {
      await ready;
      return await request<ClaimedMutation | undefined>(
        'graphql_cache_claim_next_mutation',
        { owner, nowMs, leaseExpiresAtMs }
      );
    },

    async deferOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      nextAttemptAtMs: number,
      error: string
    ): Promise<void> {
      await ready;
      await request('graphql_cache_defer_optimistic_write', {
        transactionId,
        leaseOwner: claim.owner,
        leaseGeneration: claim.generation,
        nextAttemptAtMs,
        error,
      });
    },

    async commitOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      args: CacheWriteArgs
    ): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>(
        'graphql_cache_commit_optimistic_write',
        {
          transactionId,
          leaseOwner: claim.owner,
          leaseGeneration: claim.generation,
          query: args.query,
          operationName: args.operationName,
          variables: args.variables,
          data: args.data,
        }
      );
    },

    async rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string
    ): Promise<WriteResult> {
      await ready;
      return await request<WriteResult>(
        'graphql_cache_rollback_optimistic_write',
        {
          transactionId,
          leaseOwner: claim.owner,
          leaseGeneration: claim.generation,
          error,
        }
      );
    },

    async invalidate(keys: string[]): Promise<AffectedOperationsResult> {
      await ready;
      const result = await request<AffectedOperationsResult>(
        'graphql_cache_invalidate',
        { keys }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async deleteRecords(keys: string[]): Promise<AffectedOperationsResult> {
      await ready;
      const result = await request<AffectedOperationsResult>(
        'graphql_cache_delete_records',
        { keys }
      );
      return { ...result, revision: parseCacheRevision(result.revision) };
    },

    async teardown(opKey: number): Promise<void> {
      await ready;
      await request('graphql_cache_teardown', { opId: opId(opKey) });
    },

    async clear(): Promise<CacheRevision> {
      await ready;
      return parseCacheRevision(
        await request<string>('graphql_cache_clear', {})
      );
    },

    onOpsAffected(cb: (opKeys: number[]) => void): () => void {
      affectedSubscribers.add(cb);
      return () => affectedSubscribers.delete(cb);
    },

    onCacheChanged(cb: (revision: CacheRevision) => void): () => void {
      cacheChangeSubscribers.add(cb);
      return () => cacheChangeSubscribers.delete(cb);
    },

    onCacheGenerationChanged(): () => void {
      // The native host process owns one engine generation for its lifetime.
      return () => undefined;
    },

    onMutationSettled(
      cb: (settlement: MutationSettlement) => void
    ): () => void {
      settlementSubscribers.add(cb);
      return () => settlementSubscribers.delete(cb);
    },

    dispose() {
      affectedSubscribers.clear();
      cacheChangeSubscribers.clear();
      settlementSubscribers.clear();
      void unlistenOps.then((fn) => fn?.());
      void unlistenCacheChanges.then((fn) => fn?.());
      void unlistenSettlements.then((fn) => fn?.());
    },
  };
}
