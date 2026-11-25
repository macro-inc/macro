import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';

/** Observe before submitting: settlement pushes can precede the queued result. */
export function observePropertyMutationSettlements(
  host:
    | Pick<CacheHost, 'onMutationSettled' | 'onCacheGenerationChanged'>
    | undefined
) {
  const settlements = new Map<string, MutationSettlement>();
  /** The transaction each reported write was queued as, by its mutation uuid. */
  const transactions = new Map<string, string>();
  const pending = new Set<() => void>();
  let resetError: Error | undefined;
  const wake = () => {
    const callbacks = [...pending];
    pending.clear();
    for (const callback of callbacks) callback();
  };
  const unsubscribeSettlement = host?.onMutationSettled((settlement) => {
    settlements.set(settlement.transactionId, settlement);
    if (settlement.mutationUuid)
      transactions.set(settlement.mutationUuid, settlement.transactionId);
    wake();
  });
  const unsubscribeGeneration = host?.onCacheGenerationChanged((change) => {
    if (change.queue !== 'reset') return;
    resetError = new Error('Property save interrupted by a cache reset');
    wake();
  });

  async function waitForCommit(transactionId: string): Promise<void> {
    if (!host) throw new Error('Queued property save has no cache host');
    let current = transactionId;
    while (true) {
      if (resetError) throw resetError;
      const settlement = settlements.get(current);
      if (!settlement) {
        await new Promise<void>((resolve) => pending.add(resolve));
        continue;
      }
      if (settlement.status === 'committed') return;
      if (settlement.status === 'permanently-failed') {
        throw new Error(settlement.error);
      }
      current = settlement.replacementTransactionId;
    }
  }

  return {
    waitForCommit,
    /**
     * Waits for the commit of the write queued under a mutation uuid, for a
     * write whose transaction id never reached its caller.
     */
    async waitForMutation(uuid: string): Promise<void> {
      if (!host) throw new Error('Queued property save has no cache host');
      while (true) {
        if (resetError) throw resetError;
        const transactionId = transactions.get(uuid);
        if (transactionId) return waitForCommit(transactionId);
        await new Promise<void>((resolve) => pending.add(resolve));
      }
    },
    /** Whether the cache reported a settlement of the write queued under `uuid`. */
    reported(uuid: string): boolean {
      return transactions.has(uuid);
    },
    dispose() {
      unsubscribeSettlement?.();
      unsubscribeGeneration?.();
      settlements.clear();
      transactions.clear();
      pending.clear();
    },
  };
}
