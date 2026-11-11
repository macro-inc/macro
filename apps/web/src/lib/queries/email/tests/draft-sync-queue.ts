import type {
  CacheHost,
  EnqueueOptimisticMutationArgs,
} from '@graphql-cache/host/types';
import {
  type ClaimedMutation,
  INITIAL_CACHE_REVISION,
  type MutationClaim,
  type MutationInspection,
  type MutationSettlement,
} from '@graphql-cache/protocol';
import { never } from './draft-sync-shared';

type QueueEntry = {
  transactionId: string;
  args: EnqueueOptimisticMutationArgs;
  superseded: boolean;
  attemptCount: number;
  serverFailureCount: number;
  leaseOwner?: string;
  leaseGeneration: number;
  leaseExpiresAtMs?: number;
  nextAttemptAtMs?: number;
  enqueuedAtMs: number;
};

const WRITTEN = {
  revision: INITIAL_CACHE_REVISION,
  revisionAdvanced: true,
  changed: [],
  affectedOps: [],
  reset: false,
};

/**
 * The cache engine's durable mutation queue, following `cache-core` and
 * `cache-turso`: a strict head, coalescing by UUID, leases, and the
 * settlements the worker announces. It keeps no records.
 */
export function createQueue(activity: () => void) {
  const entries: QueueEntry[] = [];
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  let next = 0;

  const confirms = (entry: QueueEntry) =>
    (entry.args.identityBindings ?? []).some(
      (binding) => binding.responsePath.length > 0
    );
  const announce = (settlement: MutationSettlement) => {
    for (const listener of [...listeners]) listener(settlement);
  };
  const claimed = (entry: QueueEntry): ClaimedMutation => ({
    transactionId: entry.transactionId,
    uuid: entry.args.uuid,
    clientMetadata: entry.args.clientMetadata,
    superseded: entry.superseded,
    requiresConfirmation: confirms(entry),
    leaseGeneration: String(entry.leaseGeneration),
    query: entry.args.query,
    operationName: entry.args.operationName,
    variables: (entry.args.variables ?? {}) as Record<string, unknown>,
    attemptCount: entry.attemptCount,
    serverFailureCount: entry.serverFailureCount,
    enqueuedAtMs: entry.enqueuedAtMs,
  });
  const claimHead = (
    owner: string,
    nowMs: number,
    leaseExpiresAtMs: number
  ) => {
    const head = entries[0];
    if (
      !head ||
      (head.leaseExpiresAtMs !== undefined && head.leaseExpiresAtMs > nowMs) ||
      (head.nextAttemptAtMs !== undefined && head.nextAttemptAtMs > nowMs)
    )
      return undefined;
    head.leaseOwner = owner;
    head.leaseGeneration += 1;
    head.leaseExpiresAtMs = leaseExpiresAtMs;
    head.nextAttemptAtMs = undefined;
    head.attemptCount += 1;
    return claimed(head);
  };
  const leased = (transactionId: string, claim: MutationClaim) => {
    const entry = entries.find((row) => row.transactionId === transactionId);
    if (!entry) throw new Error(`unknown transaction ${transactionId}`);
    if (
      entry.leaseOwner !== claim.owner ||
      String(entry.leaseGeneration) !== claim.generation
    )
      throw new Error(`stale mutation claim ${transactionId}`);
    return entry;
  };
  const replacementOf = (entry: QueueEntry) =>
    entry.superseded
      ? entries.find(
          (row) => row.args.uuid === entry.args.uuid && !row.superseded
        )?.transactionId
      : undefined;
  const remove = (entry: QueueEntry) => {
    entries.splice(entries.indexOf(entry), 1);
  };

  const engine = {
    enqueueOptimisticMutation(
      args: EnqueueOptimisticMutationArgs,
      claim: { owner: string; nowMs: number; leaseExpiresAtMs: number }
    ) {
      const transactionId = String(++next);
      const existing = entries.find(
        (row) => row.args.uuid === args.uuid && !row.superseded
      );
      let enqueuedAtMs = Date.now();
      let upsertKind:
        | { kind: 'inserted' }
        | { kind: 'replaced-pending'; removedTransactionId: string }
        | { kind: 'appended-after-active'; activeTransactionId: string } = {
        kind: 'inserted',
      };
      if (existing) {
        const active =
          (existing.leaseExpiresAtMs !== undefined &&
            existing.leaseExpiresAtMs > claim.nowMs) ||
          (existing.attemptCount > 0 && confirms(existing));
        if (active) {
          existing.superseded = true;
          upsertKind = {
            kind: 'appended-after-active',
            activeTransactionId: existing.transactionId,
          };
        } else {
          remove(existing);
          enqueuedAtMs = existing.enqueuedAtMs;
          upsertKind = {
            kind: 'replaced-pending',
            removedTransactionId: existing.transactionId,
          };
        }
      }
      entries.push({
        transactionId,
        args,
        superseded: false,
        attemptCount: 0,
        serverFailureCount: 0,
        leaseGeneration: 0,
        enqueuedAtMs,
      });
      if (upsertKind.kind === 'replaced-pending')
        announce({
          transactionId: upsertKind.removedTransactionId,
          mutationUuid: args.uuid,
          status: 'superseded',
          replacementTransactionId: transactionId,
        });
      const mutation = claimHead(
        claim.owner,
        claim.nowMs,
        claim.leaseExpiresAtMs
      );
      return {
        ...WRITTEN,
        transactionId,
        upsertKind,
        initialClaim: mutation
          ? { kind: 'claimed' as const, mutation }
          : { kind: 'not-runnable' as const },
      };
    },
    claimNextMutation: claimHead,
    deferOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      nextAttemptAtMs: number,
      _error: string,
      serverFailure = false
    ) {
      const entry = leased(transactionId, claim);
      const replacement = replacementOf(entry);
      if (replacement !== undefined && !confirms(entry)) {
        remove(entry);
        announce({
          transactionId,
          mutationUuid: entry.args.uuid,
          status: 'superseded',
          replacementTransactionId: replacement,
        });
        return {
          ...WRITTEN,
          kind: 'discarded-superseded' as const,
          replacementTransactionId: replacement,
        };
      }
      entry.leaseOwner = undefined;
      entry.leaseExpiresAtMs = undefined;
      entry.nextAttemptAtMs = nextAttemptAtMs;
      if (serverFailure) entry.serverFailureCount += 1;
      return { kind: 'deferred' as const };
    },
    commitOptimisticWrite(transactionId: string, claim: MutationClaim) {
      const entry = leased(transactionId, claim);
      const replacement = replacementOf(entry);
      remove(entry);
      announce(
        replacement === undefined
          ? {
              transactionId,
              mutationUuid: entry.args.uuid,
              status: 'committed',
            }
          : {
              transactionId,
              mutationUuid: entry.args.uuid,
              status: 'superseded',
              replacementTransactionId: replacement,
            }
      );
      return replacement === undefined
        ? {
            ...WRITTEN,
            kind: 'committed' as const,
            revalidations: entry.args.revalidations,
          }
        : {
            ...WRITTEN,
            kind: 'committed-superseded' as const,
            replacementTransactionId: replacement,
          };
    },
    rollbackOptimisticWrite(
      transactionId: string,
      claim: MutationClaim,
      error: string,
      errorCode?: string
    ) {
      const entry = leased(transactionId, claim);
      const replacement = replacementOf(entry);
      remove(entry);
      announce(
        replacement === undefined
          ? {
              transactionId,
              mutationUuid: entry.args.uuid,
              status: 'permanently-failed',
              error,
              ...(errorCode === undefined ? {} : { errorCode }),
            }
          : {
              transactionId,
              mutationUuid: entry.args.uuid,
              status: 'superseded',
              replacementTransactionId: replacement,
            }
      );
      return replacement === undefined
        ? {
            ...WRITTEN,
            kind: 'rolled-back' as const,
            revalidations: entry.args.revalidations,
          }
        : {
            ...WRITTEN,
            kind: 'discarded-superseded' as const,
            replacementTransactionId: replacement,
          };
    },
    inspectMutations: (): MutationInspection[] =>
      entries.map((entry) => ({
        transactionId: entry.transactionId,
        uuid: entry.args.uuid,
        superseded: entry.superseded,
        query: entry.args.query,
        operationName: entry.args.operationName,
        variables: (entry.args.variables ?? {}) as Record<string, unknown>,
        clientMetadata: entry.args.clientMetadata,
        enqueuedAtMs: entry.enqueuedAtMs,
        optimisticData: entry.args.data,
      })),
  };

  /** One page's view of the queue; a page that reloaded gets no more answers. */
  function connect(page: { alive: boolean }): CacheHost {
    const subscriptions = new Set<() => void>();
    const answer =
      <Args extends unknown[], Result>(work: (...args: Args) => Result) =>
      async (...args: Args): Promise<Result> => {
        if (!page.alive) return await never();
        activity();
        const result = work(...args);
        // The engine runs in a worker: every answer arrives a task later.
        await Promise.resolve();
        if (!page.alive) return await never();
        return result;
      };
    const affected = { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    const host = {
      clientId: 'page',
      currentRevision: answer(() => INITIAL_CACHE_REVISION),
      currentStorageGeneration: answer(
        () => '00000000-0000-4000-8000-000000000001'
      ),
      readQuery: answer(() => ({ kind: 'miss' as const })),
      readRecordsByKeys: answer(() => ({
        revision: INITIAL_CACHE_REVISION,
        records: [],
      })),
      search: answer(() => ({ documents: [], nextCursor: null })),
      entityFilter: answer(() => ({ kind: 'unsupported' as const })),
      calendarRange: answer(() => ({ kind: 'unsupported' as const })),
      calendarCommit: answer(() => ({ kind: 'unsupported' as const })),
      writeQuery: answer(() => WRITTEN),
      hydrateQuery: answer((args: { data: unknown }) => ({
        kind: 'data' as const,
        data: args.data,
        revision: INITIAL_CACHE_REVISION,
      })),
      inspectQueryVariants: answer(() => []),
      inspectQuery: answer(() => []),
      invalidate: answer(() => affected),
      deleteRecords: answer(() => affected),
      teardown: answer(() => undefined),
      clear: answer(() => INITIAL_CACHE_REVISION),
      enqueueOptimisticMutation: answer(engine.enqueueOptimisticMutation),
      claimNextMutation: answer(engine.claimNextMutation),
      deferOptimisticWrite: answer(engine.deferOptimisticWrite),
      commitOptimisticWrite: answer(engine.commitOptimisticWrite),
      rollbackOptimisticWrite: answer(engine.rollbackOptimisticWrite),
      inspectMutations: answer(engine.inspectMutations),
      onOpsAffected: () => () => {},
      onCacheChanged: () => () => {},
      onCacheGenerationChanged: () => () => {},
      onMutationSettled(listener: (settlement: MutationSettlement) => void) {
        const guarded = (settlement: MutationSettlement) => {
          if (page.alive) listener(settlement);
        };
        listeners.add(guarded);
        const stop = () => listeners.delete(guarded);
        subscriptions.add(stop);
        return stop;
      },
      dispose() {
        for (const stop of subscriptions) stop();
      },
    };
    return host as unknown as CacheHost;
  }

  return { connect, entries };
}
