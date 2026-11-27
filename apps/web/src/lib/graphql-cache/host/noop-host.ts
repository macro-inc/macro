import type {
  CommitOptimisticWriteResult,
  DeferOptimisticWriteResult,
  EnqueueOptimisticMutationResult,
  ReadResult,
  RollbackOptimisticWriteResult,
  WriteResult,
} from '../protocol';
import { INITIAL_CACHE_REVISION } from '../protocol';
import { CacheSettlementUnwrittenError } from './errors';
import type { CacheHost } from './types';

const emptyWriteResult = (): WriteResult => ({
  revision: INITIAL_CACHE_REVISION,
  revisionAdvanced: false,
  changed: [],
  affectedOps: [],
  reset: false,
});

/**
 * CacheHost used when the platform cannot run the shared cache engine, or
 * after a page stops using it. It never stores data. Its disabled marker
 * makes the exchange bypass optimistic persistence and forward mutations
 * directly.
 */
export function createNoopCacheHost(): CacheHost {
  return {
    clientId: 'noop',
    disabled: true,
    async currentRevision() {
      return INITIAL_CACHE_REVISION;
    },
    async currentStorageGeneration() {
      throw new Error('normalized GraphQL cache is unavailable');
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
    async calendarRange() {
      return { kind: 'unsupported' };
    },
    async calendarCommit() {
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
    // No claim is ever made here, so a settlement is one made through a host
    // that retired since: its queue row is still in a database this host
    // cannot write. Only an engine says a settlement is written.
    async deferOptimisticWrite(): Promise<DeferOptimisticWriteResult> {
      throw new CacheSettlementUnwrittenError();
    },
    async commitOptimisticWrite(): Promise<CommitOptimisticWriteResult> {
      throw new CacheSettlementUnwrittenError();
    },
    async rollbackOptimisticWrite(): Promise<RollbackOptimisticWriteResult> {
      throw new CacheSettlementUnwrittenError();
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
