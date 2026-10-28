import type { CacheGenerationChange } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { describe, expect, it, vi } from 'vitest';
import { observePropertyMutationSettlements } from './mutation-settlements';

function setup() {
  let settle!: (settlement: MutationSettlement) => void;
  let generation!: (change: CacheGenerationChange) => void;
  const unsubscribeSettlement = vi.fn();
  const unsubscribeGeneration = vi.fn();
  const observer = observePropertyMutationSettlements({
    onMutationSettled(callback) {
      settle = callback;
      return unsubscribeSettlement;
    },
    onCacheGenerationChanged(callback) {
      generation = callback;
      return unsubscribeGeneration;
    },
  });
  return {
    observer,
    settle: (event: MutationSettlement) => settle(event),
    generation: (event: CacheGenerationChange) => generation(event),
    unsubscribeSettlement,
    unsubscribeGeneration,
  };
}

describe('property mutation settlements', () => {
  it('buffers settlements that arrive before the queued acknowledgement', async () => {
    const test = setup();
    test.settle({ transactionId: '1', status: 'committed' });
    await expect(test.observer.waitForCommit('1')).resolves.toBeUndefined();
    test.observer.dispose();
    expect(test.unsubscribeSettlement).toHaveBeenCalledOnce();
    expect(test.unsubscribeGeneration).toHaveBeenCalledOnce();
  });

  it('follows superseded transactions, even when the replacement already settled', async () => {
    const test = setup();
    const pending = test.observer.waitForCommit('1');
    test.settle({ transactionId: '3', status: 'committed' });
    test.settle({
      transactionId: '2',
      status: 'superseded',
      replacementTransactionId: '3',
    });
    test.settle({
      transactionId: '1',
      status: 'superseded',
      replacementTransactionId: '2',
    });
    await expect(pending).resolves.toBeUndefined();
    test.observer.dispose();
  });

  it('propagates a replacement failure to every waiter for the same slot', async () => {
    const test = setup();
    const first = expect(test.observer.waitForCommit('1')).rejects.toThrow(
      'rejected'
    );
    const second = expect(test.observer.waitForCommit('2')).rejects.toThrow(
      'rejected'
    );
    test.settle({
      transactionId: '1',
      status: 'superseded',
      replacementTransactionId: '2',
    });
    test.settle({
      transactionId: '2',
      status: 'permanently-failed',
      error: 'rejected',
    });
    await Promise.all([first, second]);
    test.observer.dispose();
  });

  it('survives engine replacement with preserved storage', async () => {
    const test = setup();
    const pending = test.observer.waitForCommit('1');
    test.generation({ storage: 'preserved' });
    test.settle({ transactionId: '1', status: 'committed' });
    await expect(pending).resolves.toBeUndefined();
    test.observer.dispose();
  });

  it('fails pending and future waits when the durable queue is reset', async () => {
    const test = setup();
    const pending = expect(test.observer.waitForCommit('1')).rejects.toThrow(
      'cache reset'
    );
    test.generation({ storage: 'reset' });
    await pending;
    await expect(test.observer.waitForCommit('2')).rejects.toThrow(
      'cache reset'
    );
    test.observer.dispose();
  });

  it('does not report success for a queued result without a cache host', async () => {
    const observer = observePropertyMutationSettlements(undefined);
    await expect(observer.waitForCommit('1')).rejects.toThrow('no cache host');
    observer.dispose();
  });
});
