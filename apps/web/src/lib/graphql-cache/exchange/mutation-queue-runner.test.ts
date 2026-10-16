import {
  CancelEmailSendDocument,
  SendEmailMessageDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  createClient,
  createRequest,
  makeOperation,
  type Operation,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST, parse } from 'graphql';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';
import type { CacheHost } from '../host/types';
import {
  type ClaimedMutation,
  type CommitOptimisticWriteResult,
  type EnqueueOptimisticMutationResult,
  INITIAL_CACHE_REVISION,
  parseCacheRevision,
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
  vi.unstubAllGlobals();
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
    transactionId: '1',
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
    requestGeneration: String(BigInt(generation) - (claim ? 1n : 0n)),
    revision: parseCacheRevision(generation),
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
    client: createClient({
      url: 'http://test',
      exchanges: [
        () => (source) =>
          pipe(
            source,
            filter((op) => op.kind === 'mutation'),
            mergeMap((op) => {
              forwarded.push(op);
              return makeSubject<import('@urql/core').OperationResult>().source;
            })
          ),
      ],
    }),
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
  return { runner, forwarded, commit, host };
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
      '1',
      { owner: 'owner', generation: '2' },
      expect.objectContaining({ data })
    );
  }
);

it.each([false, true])(
  'ignores an older Send claim arriving after Cancel, already settled: %s',
  async (settled) => {
    const { runner, forwarded, commit } = fixture();
    await runner.admit(
      operation(true),
      enqueue(operation(true), '3', true),
      runner.epoch()
    );
    const result = {
      operation: forwarded[0],
      data: { cancelEmailSend: { attempt: { status: 'CANCELLED' } } },
      stale: false,
      hasNext: false,
    };
    if (settled) await runner.settle(result, queueAttemptOf(forwarded[0])!);
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    expect(forwarded).toHaveLength(1);
    if (!settled) await runner.settle(result, queueAttemptOf(forwarded[0])!);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(
      '1',
      { owner: 'owner', generation: '3' },
      expect.anything()
    );
  }
);

it('ignores a late unclaimed replacement acknowledgement without releasing a newer claim', async () => {
  const { runner, forwarded, commit } = fixture();
  await runner.admit(
    operation(true),
    enqueue(operation(true), '4', true),
    runner.epoch()
  );
  await runner.admit(
    operation(true),
    enqueue(operation(true), '2', true, false),
    runner.epoch()
  );
  await runner.settle(
    {
      operation: forwarded[0],
      data: { cancelEmailSend: { attempt: { status: 'CANCELLED' } } },
      stale: false,
      hasNext: false,
    },
    queueAttemptOf(forwarded[0])!
  );
  expect(forwarded).toHaveLength(1);
  expect(commit).toHaveBeenCalledOnce();
});

it('ignores a late claim from an earlier transaction after advancing the head', async () => {
  const { runner, forwarded, commit } = fixture();
  await runner.admit(
    operation(true),
    enqueue(operation(true), '3'),
    runner.epoch()
  );
  const old = enqueue(operation(), '9');
  old.transactionId = '0';
  if (old.initialClaim.kind === 'claimed')
    old.initialClaim.mutation.transactionId = '0';
  await runner.admit(operation(), old, runner.epoch());
  await runner.settle(
    {
      operation: forwarded[0],
      data: { cancelEmailSend: { attempt: { status: 'CANCELLED' } } },
      stale: false,
      hasNext: false,
    },
    queueAttemptOf(forwarded[0])!
  );
  expect(forwarded).toHaveLength(1);
  expect(commit).toHaveBeenCalledOnce();
});

it('still routes an older head enqueue after a newer tail acknowledgement', async () => {
  const { runner, forwarded } = fixture();
  const tail = enqueue(operation(true), '3', false, false);
  tail.transactionId = '2';
  await runner.admit(operation(true), tail, runner.epoch());
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  expect(forwarded).toHaveLength(1);
  expect(getOperationAST(forwarded[0].query)?.name?.value).toBe(
    'SendEmailMessage'
  );
});

it('clears claim watermarks when storage resets and reuses queue identities', async () => {
  const { runner, forwarded } = fixture();
  await runner.admit(
    operation(true),
    enqueue(operation(true), '3'),
    runner.epoch()
  );
  runner.resetStorage();
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  expect(forwarded).toHaveLength(2);
});

it('fences an unseen Send claim after Cancel was persisted without a claim', async () => {
  const { runner, forwarded } = fixture();
  await runner.admit(
    operation(true),
    enqueue(operation(true), '3', true, false),
    runner.epoch()
  );
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  expect(forwarded).toHaveLength(0);
});

it('preserves a pump claim when its unclaimed enqueue acknowledgement arrives afterward', async () => {
  const { runner, forwarded, commit, host } = fixture();
  const current = enqueue(operation(true), '5', true);
  if (current.initialClaim.kind !== 'claimed') throw new Error('Missing claim');
  const claim = current.initialClaim.mutation;
  vi.spyOn(host, 'claimNextMutation').mockResolvedValueOnce(claim);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(forwarded).toHaveLength(1);
  await runner.admit(
    operation(true),
    enqueue(operation(true), '3', true, false),
    runner.epoch()
  );
  await runner.settle(
    {
      operation: forwarded[0],
      data: { cancelEmailSend: { attempt: { status: 'CANCELLED' } } },
      stale: false,
      hasNext: false,
    },
    queueAttemptOf(forwarded[0])!
  );
  expect(commit).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledWith(
    '1',
    { owner: 'owner', generation: '5' },
    expect.anything()
  );
});

it('ignores an older pump claim after an unclaimed replacement was admitted', async () => {
  const { runner, forwarded, host } = fixture();
  const old = enqueue(operation(), '1');
  if (old.initialClaim.kind !== 'claimed') throw new Error('Missing claim');
  const pending = Promise.withResolvers<ClaimedMutation | undefined>();
  vi.spyOn(host, 'claimNextMutation').mockReturnValueOnce(pending.promise);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  await runner.admit(
    operation(true),
    enqueue(operation(true), '3', true, false),
    runner.epoch()
  );
  pending.resolve(old.initialClaim.mutation);
  await vi.advanceTimersByTimeAsync(0);
  expect(forwarded).toHaveLength(0);
});
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
        '1',
        { owner: 'owner', generation: '2' },
        expect.objectContaining({ data })
      );
    }
  }
);

it.each([false, true])(
  'offline queue drain requests an atomic non-durable claim, durable head: %s',
  async (durable) => {
    vi.stubGlobal('navigator', { onLine: false });
    const { runner, forwarded, host } = fixture();
    const op = operation();
    const initial = enqueue(op, '1');
    if (initial.initialClaim.kind !== 'claimed')
      throw new Error('fixture requires a claim');
    const mutation = initial.initialClaim.mutation;
    const claim = vi
      .fn<CacheHost['claimNextMutation']>()
      .mockImplementation(async (_owner, _now, _expiry, allowDurable) => {
        expect(allowDurable).toBe(false);
        return durable ? undefined : mutation;
      });
    host.claimNextMutation = claim;
    runner.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledOnce();
    if (durable) {
      expect(forwarded).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(claim).toHaveBeenCalledTimes(2);
      expect(forwarded).toHaveLength(0);
    } else {
      expect(forwarded).toHaveLength(1);
    }
  }
);
