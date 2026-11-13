import type { PeopleCache } from '../people/host';
import { PEOPLE_UNSUPPORTED } from '../people/protocol';
import { createNoopCacheHost } from './noop-host';
import type { CacheHost } from './types';

type RetainedCacheHost = { host: CacheHost; release: () => void };
const retainers = new WeakMap<CacheHost, () => RetainedCacheHost | undefined>();

/** Pin physical storage through logout even if auth retires its public wrapper. */
export function retainCacheHost(
  host: CacheHost
): RetainedCacheHost | undefined {
  if (host.disabled) return;
  const retain = retainers.get(host);
  return retain ? retain() : { host, release() {} };
}

/**
 * Wraps a host that its owner may abandon mid-session. `dispose()` silences
 * subscriptions and routes every later call to the storage-free no-op
 * host. References captured before retirement (the replaced urql client's
 * exchange, query closures) then see a disabled cache: reads miss to the
 * network, writes are dropped, and mutations bypass the durable queue,
 * instead of every call rejecting with "cache worker host was disposed".
 * Physical disposal waits for leases held by admitted writes and their cleanup.
 */
export function createRetirableCacheHost(inner: CacheHost): CacheHost {
  let current = inner;
  let retained = 0;
  // Resolve the current host at dispatch, including for methods captured before
  // retirement. A retired publisher must never acknowledge a dropped write.
  const people: PeopleCache | undefined = inner.people
    ? {
        async snapshot(request) {
          if (!current.people) return { kind: 'unsupported' };
          return current.people.snapshot(request);
        },
        async reconcile(request) {
          if (!current.people)
            throw new Error('Contact reconciliation is unsupported');
          return current.people.reconcile(request);
        },
        async readSql(request) {
          if (!current.people) return { kind: 'unsupported' };
          return current.people.readSql(request);
        },
        async resolveReferences(request) {
          if (!current.people) return { kind: 'unsupported' };
          return current.people.resolveReferences(request);
        },
        async context(scope) {
          if (!current.people) return { kind: 'unsupported' };
          return current.people.context(scope);
        },
        async update(update) {
          if (!current.people) throw new Error(PEOPLE_UNSUPPORTED);
          return current.people.update(update);
        },
        async search(request) {
          if (!current.people) return { kind: 'unsupported' };
          return current.people.search(request);
        },
      }
    : undefined;
  const wrapper: CacheHost = {
    clientId: inner.clientId,
    people,
    get liveQueries() {
      return current.liveQueries;
    },
    get disabled() {
      return current.disabled;
    },
    currentRevision: () => current.currentRevision(),
    currentStorageGeneration: () => current.currentStorageGeneration(),
    readQuery: (args) => current.readQuery(args),
    watchQuery: (args) =>
      current.watchQuery?.(args) ?? Promise.resolve({ kind: 'unsupported' }),
    readRecordsByKeys: (args) => current.readRecordsByKeys(args),
    search: (args, options) => current.search(args, options),
    entityFilter: (args) => current.entityFilter(args),
    calendarRange: (args) => current.calendarRange(args),
    calendarCommit: (args) => current.calendarCommit(args),
    channelTimeline: (args) => current.channelTimeline(args),
    channelTimelineCommit: (args) => current.channelTimelineCommit(args),
    channelTimelineEvict: (args) => current.channelTimelineEvict(args),
    channelTimelineStats: () => current.channelTimelineStats(),
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
    deferOptimisticWrite: (
      transactionId,
      claim,
      nextAttemptAtMs,
      error,
      serverFailure
    ) =>
      current.deferOptimisticWrite(
        transactionId,
        claim,
        nextAttemptAtMs,
        error,
        serverFailure
      ),
    commitOptimisticWrite: (transactionId, claim, args) =>
      current.commitOptimisticWrite(transactionId, claim, args),
    rollbackOptimisticWrite: (transactionId, claim, error, errorCode) =>
      current.rollbackOptimisticWrite(transactionId, claim, error, errorCode),
    invalidate: (keys) => current.invalidate(keys),
    deleteRecords: (keys) => current.deleteRecords(keys),
    teardown: (opKey) => current.teardown(opKey),
    clear: () => current.clear(),
    onOpsAffected: (cb) =>
      current.onOpsAffected((...args) => {
        if (current === inner) cb(...args);
      }),
    onCacheChanged: (cb, options) =>
      current.onCacheChanged((...args) => {
        if (current === inner) cb(...args);
      }, options),
    onCacheGenerationChanged: (cb) =>
      current.onCacheGenerationChanged((...args) => {
        if (current === inner) cb(...args);
      }),
    onMutationSettled: (cb) =>
      current.onMutationSettled((...args) => {
        if (current === inner) cb(...args);
      }),
    dispose() {
      if (current !== inner) return;
      current = createNoopCacheHost();
      if (retained === 0) inner.dispose();
    },
  };
  const retain = () => {
    if (current !== inner && retained === 0) return;
    retained += 1;
    let released = false;
    return {
      host: inner,
      release() {
        if (released) return;
        released = true;
        retained -= 1;
        if (retained === 0 && current !== inner) inner.dispose();
      },
    };
  };
  retainers.set(wrapper, retain);
  // An existing lease may need an independent pin for a later serialized wipe.
  // It can clone ownership after public retirement, but not after disposal.
  retainers.set(inner, retain);
  return wrapper;
}
