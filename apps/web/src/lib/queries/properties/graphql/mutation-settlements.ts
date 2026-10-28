import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';

/** Observe before submitting: settlement pushes can precede the queued result. */
export function observePropertyMutationSettlements(
  host:
    | Pick<CacheHost, 'onMutationSettled' | 'onCacheGenerationChanged'>
    | undefined
) {
  const settlements = new Map<string, MutationSettlement>();
  const pending = new Set<() => void>();
  let resetError: Error | undefined;
  const wake = () => {
    const callbacks = [...pending];
    pending.clear();
    for (const callback of callbacks) callback();
  };
  const unsubscribeSettlement = host?.onMutationSettled((settlement) => {
    settlements.set(settlement.transactionId, settlement);
    wake();
  });
  const unsubscribeGeneration = host?.onCacheGenerationChanged((change) => {
    if (change.storage !== 'reset') return;
    resetError = new Error('Property save interrupted by a cache reset');
    wake();
  });

  return {
    async waitForCommit(transactionId: string): Promise<void> {
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
    },
    dispose() {
      unsubscribeSettlement?.();
      unsubscribeGeneration?.();
      settlements.clear();
      pending.clear();
    },
  };
}
