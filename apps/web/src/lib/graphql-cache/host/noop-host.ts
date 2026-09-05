import type {
  CommitOptimisticWriteResult,
  EnqueueOptimisticMutationResult,
  ReadResult,
  WriteResult,
} from '../protocol';
import { INITIAL_CACHE_REVISION } from '../protocol';
import type { CacheHost } from './types';

const emptyWriteResult = (): WriteResult => ({
  revision: INITIAL_CACHE_REVISION,
  revisionAdvanced: false,
  changed: [],
  affectedOps: [],
  reset: false,
});

/**
 * CacheHost used when the platform cannot run the shared cache engine.
 * It never stores data. Its disabled marker makes the exchange bypass
 * optimistic persistence and forward mutations directly.
 */
export function createNoopCacheHost(reason: string): CacheHost {
  console.warn(`[graphql-cache] disabled: ${reason}`);

  return {
    clientId: 'noop',
    disabled: true,
    async currentRevision() {
      return INITIAL_CACHE_REVISION;
    },
    async readQuery(): Promise<ReadResult> {
      return { kind: 'miss' };
    },
    async readRecordsByKeys() {
      return { revision: INITIAL_CACHE_REVISION, records: [] };
    },
    async search() {
      return { documents: [], nextCursor: null };
    },
    async entityFilter() {
      return { kind: 'unsupported' };
    },
    async writeQuery(): Promise<WriteResult> {
      return emptyWriteResult();
    },
    async hydrateQuery() {
      throw new Error('normalized GraphQL cache is unavailable');
    },
    async enqueueOptimisticMutation(): Promise<EnqueueOptimisticMutationResult> {
      throw new Error('normalized GraphQL cache is unavailable');
    },
    async inspectQueryVariants() {
      return [];
    },
    async inspectQuery() {
      return [];
    },
    async claimNextMutation() {
      return undefined;
    },
    async deferOptimisticWrite() {
      return { kind: 'deferred' } as const;
    },
    async commitOptimisticWrite(): Promise<CommitOptimisticWriteResult> {
      return { kind: 'committed', ...emptyWriteResult() };
    },
    async rollbackOptimisticWrite() {
      return { kind: 'rolled-back' as const, ...emptyWriteResult() };
    },
    async invalidate() {
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    },
    async deleteRecords() {
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    },
    async teardown(): Promise<void> {},
    async clear() {
      return INITIAL_CACHE_REVISION;
    },
    onOpsAffected() {
      return () => undefined;
    },
    onCacheChanged() {
      return () => undefined;
    },
    onCacheGenerationChanged() {
      return () => undefined;
    },
    onMutationSettled() {
      return () => undefined;
    },
    dispose() {},
  };
}
