import type {
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from '../protocol';
import type { CacheHost } from './types';

const emptyWriteResult = (): WriteResult => ({
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
    async readQuery(): Promise<ReadResult> {
      return { kind: 'miss' };
    },
    async writeQuery(): Promise<WriteResult> {
      return emptyWriteResult();
    },
    async beginOptimisticWrite(): Promise<OptimisticWriteResult> {
      throw new Error('normalized GraphQL cache is unavailable');
    },
    async claimNextMutation() {
      return undefined;
    },
    async deferOptimisticWrite(): Promise<void> {},
    async commitOptimisticWrite(): Promise<WriteResult> {
      return emptyWriteResult();
    },
    async rollbackOptimisticWrite(): Promise<WriteResult> {
      return emptyWriteResult();
    },
    async invalidate(): Promise<string[]> {
      return [];
    },
    async teardown(): Promise<void> {},
    async clear(): Promise<void> {},
    onOpsAffected() {
      return () => undefined;
    },
    dispose() {},
  };
}
