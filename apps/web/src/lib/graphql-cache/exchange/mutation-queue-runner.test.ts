import {
  CancelEmailSendDocument,
  SendEmailMessageDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  createRequest,
  makeOperation,
  type Operation,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST, parse } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CacheHost } from '../host/types';
import {
  type ClaimedMutation,
  type CommitOptimisticWriteResult,
  type EnqueueOptimisticMutationResult,
  INITIAL_CACHE_REVISION,
} from '../protocol';
import {
  createMutationQueueRunner,
  type MutationQueueRunner,
  queueAttemptOf,
} from './mutation-queue-runner';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
function operation(cancel = false): Operation {
  return makeOperation(
    'mutation',
    createRequest(
      parse(
        stringifyDocument(
          cancel ? CancelEmailSendDocument : SendEmailMessageDocument
        )
      ),
      { input: { attemptId: 'attempt', linkId: 'inbox' } }
    ),
    { url: 'http://test', requestPolicy: 'cache-first' }
  );
}
function enqueue(
  op: Operation,
  generation: string,
  replaced = false,
  claim = true
): EnqueueOptimisticMutationResult {
  const mutation: ClaimedMutation = {
    transactionId: 'same-transaction',
    uuid: 'same-attempt',
    query: stringifyDocument(op.query),
    operationName: getOperationAST(op.query)?.name?.value,
    variables: op.variables ?? {},
    leaseGeneration: generation,
    attemptCount: Number(generation),
    serverFailureCount: 0,
    superseded: false,
    requiresConfirmation: false,
  };
  return {
    transactionId: mutation.transactionId,
    revision: INITIAL_CACHE_REVISION,
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
    upsertKind: replaced
      ? {
          kind: 'replaced-pending',
          removedTransactionId: mutation.transactionId,
        }
      : { kind: 'inserted' },
    initialClaim: claim
      ? { kind: 'claimed', mutation }
      : { kind: 'not-runnable' },
  };
}
function fixture() {
  const forwarded: Operation[] = [];
  const commit = vi.fn<CacheHost['commitOptimisticWrite']>(
    async () =>
      ({
        kind: 'committed',
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
      }) satisfies CommitOptimisticWriteResult
  );
  const host = {
    commitOptimisticWrite: commit,
    currentRevision: async () => INITIAL_CACHE_REVISION,
    claimNextMutation: async () => undefined,
  } as unknown as CacheHost;
  let runner!: MutationQueueRunner;
  runner = createMutationQueueRunner({
    host,
    client: {} as Client,
    options: {},
    owner: 'owner',
    forward: (op) => forwarded.push(op),
    writeThrough: (result) =>
      runner.settle(result, queueAttemptOf(result.operation)!),
    cacheDocument: (op) => ({
      query: stringifyDocument(op.query),
      operationName: getOperationAST(op.query)?.name?.value,
      variables: op.variables ?? {},
    }),
    deleteReportedRecords: async () => {},
    replayExplicitEffects: () => undefined,
    revalidate: async () => {},
  });
  return { runner, forwarded, commit };
}
it.each([true, false])(
  'sends same-ID cancellation after failed Send persistence, local replacement: %s',
  async (local) => {
    const { runner, forwarded, commit } = fixture();
    commit.mockRejectedValueOnce(
      new Error('Local commit acknowledgement lost')
    );
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    await runner.settle(
      {
        operation: forwarded[0],
        data: { sendEmailMessage: { attempt: { status: 'ACCEPTED' } } },
        stale: false,
        hasNext: false,
      },
      queueAttemptOf(forwarded[0])!
    );
    // A cross-tab replacement has no local replaced-pending notification.
    await runner.admit(
      operation(true),
      enqueue(operation(true), '2', local),
      runner.epoch()
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(
      forwarded.map((op) => getOperationAST(op.query)?.name?.value)
    ).toEqual(['SendEmailMessage', 'CancelEmailSend']);
    const data = { cancelEmailSend: { status: 'CANCELLED' } };
    await runner.settle(
      { operation: forwarded[1], data, stale: false, hasNext: false },
      queueAttemptOf(forwarded[1])!
    );
    expect(commit).toHaveBeenLastCalledWith(
      'same-transaction',
      { owner: 'owner', generation: '2' },
      expect.objectContaining({ data })
    );
  }
);
it.each([true, false])(
  'ignores late Send results after same-ID replacement, cancellation claimed: %s',
  async (claimed) => {
    const { runner, forwarded, commit } = fixture();
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    await runner.admit(
      operation(true),
      enqueue(operation(true), '2', true, claimed),
      runner.epoch()
    );
    await runner.settle(
      {
        operation: forwarded[0],
        data: { sendEmailMessage: { attempt: { status: 'ACCEPTED' } } },
        stale: false,
        hasNext: false,
      },
      queueAttemptOf(forwarded[0])!
    );
    expect(commit).not.toHaveBeenCalled();
    if (claimed) {
      const data = { cancelEmailSend: { status: 'CANCELLED' } };
      await runner.settle(
        { operation: forwarded[1], data, stale: false, hasNext: false },
        queueAttemptOf(forwarded[1])!
      );
      expect(commit).toHaveBeenCalledOnce();
      expect(commit).toHaveBeenLastCalledWith(
        'same-transaction',
        { owner: 'owner', generation: '2' },
        expect.objectContaining({ data })
      );
    }
  }
);
