import { createNoopCacheHost } from './noop-host';
import type { CacheHost } from './types';

/**
 * Wraps a host that its owner may abandon mid-session. `dispose()` releases
 * the wrapped host and routes every later call to the storage-free no-op
 * host. References captured before retirement (the replaced urql client's
 * exchange, query closures) then see a disabled cache: reads miss to the
 * network, writes are dropped, and mutations bypass the durable queue,
 * instead of every call rejecting with "cache worker host was disposed".
 */
export function createRetirableCacheHost(inner: CacheHost): CacheHost {
  let current = inner;
  return {
    clientId: inner.clientId,
    get disabled() {
      return current.disabled;
    },
    currentRevision: () => current.currentRevision(),
    currentStorageGeneration: () => current.currentStorageGeneration(),
    readQuery: (args) => current.readQuery(args),
    readRecordsByKeys: (args) => current.readRecordsByKeys(args),
    search: (args) => current.search(args),
    entityFilter: (args) => current.entityFilter(args),
    writeQuery: (args) => current.writeQuery(args),
    hydrateQuery: (args) => current.hydrateQuery(args),
    enqueueOptimisticMutation: (args, claim) =>
      current.enqueueOptimisticMutation(args, claim),
    inspectQueryVariants: (args) => current.inspectQueryVariants(args),
    inspectQuery: (args) => current.inspectQuery(args),
    inspectMutations: () =>
      current.inspectMutations?.() ??
      Promise.reject(new Error('Queue inspection is unavailable')),
    claimNextMutation: (owner, nowMs, leaseExpiresAtMs) =>
      current.claimNextMutation(owner, nowMs, leaseExpiresAtMs),
    deferOptimisticWrite: (transactionId, claim, nextAttemptAtMs, error) =>
      current.deferOptimisticWrite(
        transactionId,
        claim,
        nextAttemptAtMs,
        error
      ),
    commitOptimisticWrite: (transactionId, claim, args) =>
      current.commitOptimisticWrite(transactionId, claim, args),
    rollbackOptimisticWrite: (transactionId, claim, error) =>
      current.rollbackOptimisticWrite(transactionId, claim, error),
    invalidate: (keys) => current.invalidate(keys),
    deleteRecords: (keys) => current.deleteRecords(keys),
    teardown: (opKey) => current.teardown(opKey),
    clear: () => current.clear(),
    onOpsAffected: (cb) => current.onOpsAffected(cb),
    onCacheChanged: (cb, options) => current.onCacheChanged(cb, options),
    onCacheGenerationChanged: (cb) => current.onCacheGenerationChanged(cb),
    onMutationSettled: (cb) => current.onMutationSettled(cb),
    dispose() {
      if (current !== inner) return;
      current = createNoopCacheHost();
      inner.dispose();
    },
  };
}
