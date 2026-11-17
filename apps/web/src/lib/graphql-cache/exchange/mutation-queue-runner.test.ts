import { SaveEmailDraftDocument } from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  createClient,
  createRequest,
  makeOperation,
  type Operation,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST, parse } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  type MutationQueueRunnerDeps,
  queueAttemptOf,
  withQueueRequestTimeout,
} from './mutation-queue-runner';
import {
  type MutationAttemptTelemetry,
  NOOP_MUTATION_QUEUE_TELEMETRY,
} from './mutation-queue-telemetry';
import { optimisticMutationDispositionOf } from './optimistic';
import type { QueueOwners } from './queue-owners';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function operation(): Operation {
  return makeOperation(
    'mutation',
    createRequest(parse(stringifyDocument(SaveEmailDraftDocument)), {
      input: { draftId: 'draft', subject: 'Draft' },
    }),
    { url: 'http://test', requestPolicy: 'cache-first' }
  );
}
function enqueue(
  op: Operation,
  generation: string,
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
    revision: parseCacheRevision(generation),
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
    upsertKind: { kind: 'inserted' },
    initialClaim: claim
      ? { kind: 'claimed', mutation }
      : { kind: 'not-runnable' },
  };
}
function fixture(
  options: MutationQueueRunnerDeps['options'] = {},
  queueOwners?: QueueOwners
) {
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
    deferOptimisticWrite: vi.fn(async () => ({ kind: 'deferred' })),
    rollbackOptimisticWrite: vi.fn(async () => ({
      kind: 'rolled-back',
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
    })),
    currentRevision: async () => INITIAL_CACHE_REVISION,
    currentStorageGeneration: async () => 'storage',
    claimNextMutation: vi.fn(async () => undefined),
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
    options,
    owner: 'owner',
    queueOwners,
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
it.each([false, true])(
  'ignores an older lease arriving after a newer draft claim, already settled: %s',
  async (settled) => {
    const { runner, forwarded, commit } = fixture();
    await runner.admit(operation(), enqueue(operation(), '3'), runner.epoch());
    const result = {
      operation: forwarded[0],
      data: { saveEmailDraft: { draftId: 'draft', subject: 'Draft' } },
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

it('ignores a late unclaimed enqueue acknowledgement without releasing a newer claim', async () => {
  const { runner, forwarded, commit } = fixture();
  await runner.admit(operation(), enqueue(operation(), '4'), runner.epoch());
  await runner.admit(
    operation(),
    enqueue(operation(), '2', false),
    runner.epoch()
  );
  await runner.settle(
    {
      operation: forwarded[0],
      data: { saveEmailDraft: { draftId: 'draft', subject: 'Draft' } },
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
  await runner.admit(operation(), enqueue(operation(), '3'), runner.epoch());
  const old = enqueue(operation(), '9');
  old.transactionId = '0';
  if (old.initialClaim.kind === 'claimed')
    old.initialClaim.mutation.transactionId = '0';
  await runner.admit(operation(), old, runner.epoch());
  await runner.settle(
    {
      operation: forwarded[0],
      data: { saveEmailDraft: { draftId: 'draft', subject: 'Draft' } },
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
  const tail = enqueue(operation(), '3', false);
  tail.transactionId = '2';
  await runner.admit(operation(), tail, runner.epoch());
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  expect(forwarded).toHaveLength(1);
  expect(getOperationAST(forwarded[0].query)?.name?.value).toBe(
    'SaveEmailDraft'
  );
});

it('clears claim watermarks when storage resets and reuses queue identities', async () => {
  const { runner, forwarded } = fixture();
  await runner.admit(operation(), enqueue(operation(), '3'), runner.epoch());
  runner.resetStorage();
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  expect(forwarded).toHaveLength(2);
});

it('preserves a pump claim when its unclaimed enqueue acknowledgement arrives afterward', async () => {
  const { runner, forwarded, commit, host } = fixture();
  const current = enqueue(operation(), '5');
  if (current.initialClaim.kind !== 'claimed') throw new Error('Missing claim');
  const claim = current.initialClaim.mutation;
  vi.spyOn(host, 'claimNextMutation').mockResolvedValueOnce(claim);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(forwarded).toHaveLength(1);
  await runner.admit(
    operation(),
    enqueue(operation(), '3', false),
    runner.epoch()
  );
  await runner.settle(
    {
      operation: forwarded[0],
      data: { saveEmailDraft: { draftId: 'draft', subject: 'Draft' } },
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

function recordingTelemetry() {
  const attempts: Array<{ sent: string[]; finished: unknown[][] }> = [];
  const run = vi.fn((send: () => unknown) => send());
  const telemetry = {
    ...NOOP_MUTATION_QUEUE_TELEMETRY,
    attempt: () => {
      const record = { sent: [] as string[], finished: [] as unknown[][] };
      attempts.push(record);
      return {
        run: <T>(send: () => T) => run(send) as T,
        sent: (mode) => {
          record.sent.push(mode);
        },
        finish: (...args) => {
          record.finished.push(args);
        },
      } satisfies MutationAttemptTelemetry;
    },
  };
  return { telemetry, attempts, run };
}

const savedDraft = { saveEmailDraft: { draftId: 'draft', subject: 'Draft' } };

it('ends a live attempt once, as committed', async () => {
  const { telemetry, attempts } = recordingTelemetry();
  const { runner, forwarded } = fixture({ mutationQueueTelemetry: telemetry });
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  await runner.settle(
    { operation: forwarded[0], data: savedDraft, stale: false, hasNext: false },
    queueAttemptOf(forwarded[0])!
  );
  expect(attempts).toEqual([{ sent: ['live'], finished: [['committed', {}]] }]);
});

it('sends a queued request inside its attempt span', async () => {
  const { telemetry, run } = recordingTelemetry();
  const { runner, forwarded } = fixture({ mutationQueueTelemetry: telemetry });
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  const transport = vi.fn(async () => new Response('{}', { status: 200 }));
  const op = makeOperation(forwarded[0].kind, forwarded[0], {
    ...forwarded[0].context,
    fetch: transport,
  });
  await withQueueRequestTimeout(op).context.fetch!('http://test', {});
  expect(run).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledOnce();
});

it('reports a retried server failure with its backoff', async () => {
  const { telemetry, attempts } = recordingTelemetry();
  const { runner, forwarded } = fixture({
    mutationQueueTelemetry: telemetry,
    shouldRetryMutation: () => true,
  });
  await runner.admit(operation(), enqueue(operation(), '2'), runner.epoch());
  const attempt = queueAttemptOf(forwarded[0])!;
  attempt.response = new Response(null, { status: 503 });
  await runner.settle(
    { operation: forwarded[0], data: savedDraft, stale: false, hasNext: false },
    attempt
  );
  expect(attempts[0]?.finished).toEqual([
    [
      'retry-scheduled',
      {
        failure: 'server',
        errorCode: undefined,
        httpStatus: 503,
        retryDelayMs: 2_000,
      },
    ],
  ]);
});

it('reports retry exhaustion apart from a permanent rollback', async () => {
  const { telemetry, attempts } = recordingTelemetry();
  const { runner, forwarded } = fixture({
    mutationQueueTelemetry: telemetry,
    shouldRetryMutation: () => true,
  });
  const exhausted = enqueue(operation(), '10');
  if (exhausted.initialClaim.kind !== 'claimed')
    throw new Error('Missing claim');
  exhausted.initialClaim.mutation.serverFailureCount = 9;
  await runner.admit(operation(), exhausted, runner.epoch());
  await runner.settle(
    {
      operation: forwarded[0],
      data: undefined,
      error: new CombinedError({
        graphQLErrors: [
          { message: 'boom', extensions: { code: 'INTERNAL' }, path: ['x'] },
        ],
      }),
      stale: false,
      hasNext: false,
    },
    queueAttemptOf(forwarded[0])!
  );
  expect(attempts[0]?.finished).toEqual([
    [
      'retry-exhausted',
      { failure: 'server', errorCode: 'INTERNAL', httpStatus: undefined },
    ],
  ]);
});

describe('leases left unsettled', () => {
  const owners = (
    leases: Awaited<ReturnType<QueueOwners['abandoned']>>['leases'],
    pendingUntil?: number
  ) =>
    ({
      record: vi.fn(),
      othersOnRecord: () => leases.length > 0 || pendingUntil !== undefined,
      abandoned: vi.fn(async () => ({ leases, pendingUntil })),
      dispose: () => undefined,
    }) satisfies QueueOwners;

  it('is on record before the request is sent', async () => {
    const queueOwners = owners([]);
    const { runner, forwarded } = fixture({}, queueOwners);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(queueOwners.record).toHaveBeenLastCalledWith('storage');

    queueOwners.record.mockImplementation(() => {
      expect(forwarded).toHaveLength(0);
    });
    await runner.admit(operation(), enqueue(operation(), '4'), runner.epoch());
    expect(queueOwners.record).toHaveBeenLastCalledWith('storage', {
      transactionId: '1',
      leaseGeneration: '4',
      itemId: 'same-attempt',
    });
    expect(forwarded).toHaveLength(1);
  });

  it('comes off the record once the attempt is over', async () => {
    const queueOwners = owners([]);
    const { runner, forwarded } = fixture({}, queueOwners);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    await runner.settle(
      {
        operation: forwarded[0],
        data: savedDraft,
        stale: false,
        hasNext: false,
      },
      queueAttemptOf(forwarded[0])!
    );
    // The drain that follows finds the queue empty.
    await vi.advanceTimersByTimeAsync(0);
    expect(queueOwners.record).toHaveBeenLastCalledWith('storage');
  });

  it('is given back when its page is gone, and the head is claimed at once', async () => {
    const gone = {
      owner: 'gone',
      transactionId: '1',
      leaseGeneration: '2',
      itemId: 'item',
    };
    const queueOwners = owners([gone]);
    const { telemetry } = recordingTelemetry();
    const released = vi.spyOn(telemetry, 'abandonedLease');
    const { runner, forwarded, host } = fixture(
      { mutationQueueTelemetry: telemetry },
      queueOwners
    );
    const head = enqueue(operation(), '3').initialClaim;
    vi.mocked(host.claimNextMutation)
      // Leased to the runner that is gone.
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(
        head.kind === 'claimed' ? head.mutation : undefined
      );
    runner.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(host.deferOptimisticWrite).toHaveBeenCalledExactlyOnceWith(
      '1',
      { owner: 'gone', generation: '2' },
      expect.any(Number),
      'Queue runner is gone'
    );
    expect(released).toHaveBeenCalledExactlyOnceWith('released', gone);
    expect(host.claimNextMutation).toHaveBeenCalledTimes(2);
    expect(forwarded).toHaveLength(1);
  });

  it('is asked for again once its request can no longer be on the wire', async () => {
    const queueOwners = owners([], Date.now() + 12_000);
    const { runner, host } = fixture({}, queueOwners);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(queueOwners.abandoned).toHaveBeenLastCalledWith('storage', 70_000);
    expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
    expect(host.claimNextMutation).toHaveBeenCalledOnce();

    // Sooner than the regular thirty-second poll.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(host.claimNextMutation).toHaveBeenCalledTimes(2);
    expect(queueOwners.abandoned).toHaveBeenCalledTimes(2);
  });

  it('is left to run out when the gone runner had already settled it', async () => {
    const gone = {
      owner: 'gone',
      transactionId: '1',
      leaseGeneration: '2',
      itemId: 'item',
    };
    const queueOwners = owners([gone]);
    const { telemetry } = recordingTelemetry();
    const stale = vi.spyOn(telemetry, 'abandonedLease');
    const { runner, host } = fixture(
      { mutationQueueTelemetry: telemetry },
      queueOwners
    );
    vi.mocked(host.deferOptimisticWrite).mockRejectedValue(
      new Error('stale mutation claim')
    );
    runner.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(host.deferOptimisticWrite).toHaveBeenCalledOnce();
    expect(stale).toHaveBeenCalledExactlyOnceWith('stale', gone);
    // Nothing was released, so the head is not asked for again.
    expect(host.claimNextMutation).toHaveBeenCalledOnce();
  });

  it('is given back by its own runner after a lost acknowledgement', async () => {
    const { telemetry, attempts } = recordingTelemetry();
    const { runner, forwarded, commit, host } = fixture({
      mutationQueueTelemetry: telemetry,
    });
    commit.mockRejectedValueOnce(new Error('local disk unavailable'));
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    await runner.settle(
      {
        operation: forwarded[0],
        data: savedDraft,
        stale: false,
        hasNext: false,
      },
      queueAttemptOf(forwarded[0])!
    );

    expect(host.deferOptimisticWrite).toHaveBeenCalledExactlyOnceWith(
      '1',
      { owner: 'owner', generation: '1' },
      Date.now() + 5_000,
      'Acknowledgement lost'
    );
    expect(attempts[0]?.finished).toEqual([
      ['ack-lost', { retryDelayMs: 5_000 }],
    ]);
  });

  it('waits out the lease when it cannot be given back either', async () => {
    const { telemetry, attempts } = recordingTelemetry();
    const { runner, forwarded, commit, host } = fixture({
      mutationQueueTelemetry: telemetry,
    });
    commit.mockRejectedValueOnce(new Error('local disk unavailable'));
    vi.mocked(host.deferOptimisticWrite).mockRejectedValueOnce(
      new Error('local disk unavailable')
    );
    await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
    await runner.settle(
      {
        operation: forwarded[0],
        data: savedDraft,
        stale: false,
        hasNext: false,
      },
      queueAttemptOf(forwarded[0])!
    );

    expect(attempts[0]?.finished).toEqual([
      ['ack-lost', { retryDelayMs: 300_000 }],
    ]);
  });
});

it('lets a replacement run at once when the unsettled head was superseded', async () => {
  const { telemetry, attempts } = recordingTelemetry();
  const { runner, forwarded, commit, host } = fixture({
    mutationQueueTelemetry: telemetry,
  });
  commit.mockRejectedValueOnce(new Error('local disk unavailable'));
  vi.mocked(host.deferOptimisticWrite).mockResolvedValueOnce({
    kind: 'discarded-superseded',
    replacementTransactionId: '2',
    revision: INITIAL_CACHE_REVISION,
    affectedOps: [],
  } as never);
  await runner.admit(operation(), enqueue(operation(), '1'), runner.epoch());
  const settled = await runner.settle(
    { operation: forwarded[0], data: savedDraft, stale: false, hasNext: false },
    queueAttemptOf(forwarded[0])!
  );

  expect(attempts[0]?.finished).toEqual([['superseded', {}]]);
  // The caller's write lives on in the replacement.
  expect(optimisticMutationDispositionOf(settled)).toEqual({
    kind: 'queued',
    transactionId: '2',
  });
});
