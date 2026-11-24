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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';
import type { CacheHost } from '../host/types';
import {
  type ClaimedMutation,
  type CommitOptimisticWriteResult,
  type EnqueueOptimisticMutationResult,
  INITIAL_CACHE_REVISION,
  type MutationInspection,
  parseCacheRevision,
} from '../protocol';
import { cacheSessionGeneration } from '../session-generation';
import type { MutationQueueOwner } from './mutation-queue-owner';
import {
  createMutationQueueRunner,
  type MutationQueueRunner,
  type MutationQueueRunnerDeps,
  queueAttemptOf,
  withQueueRequestTimeout,
} from './mutation-queue-runner';
import {
  type MutationAttemptTelemetry,
  type MutationQueueTelemetry,
  NOOP_MUTATION_QUEUE_TELEMETRY,
} from './mutation-queue-telemetry';

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
/** An owner that cannot judge whether another page has gone. */
const PLAIN_OWNER: MutationQueueOwner = {
  claimOwner: () => 'owner',
  holds: () => true,
  departed: () => undefined,
  dispose: () => {},
};
function fixture(
  options: MutationQueueRunnerDeps['options'] = {},
  owner: MutationQueueOwner = PLAIN_OWNER
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
    claimNextMutation: async () => undefined,
  } as unknown as CacheHost;
  const revalidate = vi.fn(async () => {});
  const replayExplicitEffects = vi.fn(() => undefined);
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
    owner,
    forward: (op) => forwarded.push(op),
    writeThrough: (result) =>
      runner.settle(result, queueAttemptOf(result.operation)!),
    cacheDocument: (op) => ({
      query: stringifyDocument(op.query),
      operationName: getOperationAST(op.query)?.name?.value,
      variables: op.variables ?? {},
    }),
    deleteReportedRecords: async () => ({ attempted: false }),
    replayExplicitEffects,
    revalidate,
  });
  return { runner, forwarded, commit, host, revalidate, replayExplicitEffects };
}

it.each([
  {
    saveEmailDraft: {
      draftId: 'canonical-draft',
      thread: { id: 'canonical-thread' },
    },
  },
  {
    moveEntities: {
      results: [{ __typename: 'GraphqlMutationError', message: 'No access' }],
    },
  },
])(
  'keeps a stale server outcome and journal data while suppressing cache publication: %j',
  async (data) => {
    const journal = vi.fn(async () => {});
    const { runner, forwarded, commit, revalidate, replayExplicitEffects } =
      fixture({
        onMutationAttemptResult: journal,
      });
    const op = operation();
    const revalidations = [
      {
        query: 'query PropertyParent { user { id } }',
        operationName: 'PropertyParent',
        variablesJson: '{}',
        onlyOnLinkFailure: true,
      },
    ];
    commit.mockResolvedValue({
      kind: 'committed',
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
      revalidations,
    });
    await runner.admit(op, enqueue(op, '1'), runner.epoch());
    await cacheSessionGeneration.transition(async () => {});
    const result = {
      operation: forwarded[0],
      data,
      stale: false,
      hasNext: false,
    };
    const settled = await runner.settle(result, queueAttemptOf(forwarded[0])!);
    expect(journal).toHaveBeenCalledWith(expect.anything(), result, false);
    expect(commit).toHaveBeenCalledWith(
      '1',
      { owner: 'owner', generation: '1' },
      expect.objectContaining({
        data,
        generation: forwarded[0].context.cacheSessionGeneration,
      })
    );
    expect(journal.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0]
    );
    expect(settled.data).toEqual(data);
    expect(
      settled.extensions?.normalizedCacheMutationDisposition
    ).toMatchObject({ kind: 'committed' });
    expect(replayExplicitEffects).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledWith(
      revalidations,
      expect.anything(),
      [],
      true
    );
  }
);

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

const GONE = 'exchange-live:gone';

/** The queue head as an inspection reports it, claimed by `leaseOwner`. */
function headLeasedBy(
  leaseOwner: string,
  expiresAtMs = Date.now() + 300_000,
  generation = '4',
  transactionId = '1'
): MutationInspection {
  return {
    transactionId,
    uuid: 'same-attempt',
    superseded: false,
    query: stringifyDocument(operation().query),
    operationName: 'SaveEmailDraft',
    variables: {},
    clientMetadata: null,
    optimisticData: savedDraft,
    lease: { owner: leaseOwner, generation, expiresAtMs },
  };
}

/** A live owner; `departure` says when another live owner's page goes. */
function liveOwner(departure: () => Promise<void>) {
  return {
    claimOwner: () => 'exchange-live:here',
    holds: () => true,
    dispose: () => {},
    departed: vi.fn((leaseOwner: string) =>
      leaseOwner.startsWith('exchange-live:') ? departure() : undefined
    ),
  } satisfies MutationQueueOwner;
}

function claimOf(result: EnqueueOptimisticMutationResult): ClaimedMutation {
  if (result.initialClaim.kind !== 'claimed') throw new Error('Missing claim');
  return result.initialClaim.mutation;
}

it('releases the claim a departed page left on the head, then sends the head', async () => {
  const { runner, forwarded, host } = fixture(
    {},
    liveOwner(async () => {})
  );
  host.inspectMutations = vi.fn(async () => [headLeasedBy(GONE)]);
  const claim = vi
    .spyOn(host, 'claimNextMutation')
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(claimOf(enqueue(operation(), '5')));
  const startedAt = Date.now();
  runner.start();
  // A request the page left in flight gets a second to land.
  await vi.advanceTimersByTimeAsync(999);
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(host.deferOptimisticWrite).toHaveBeenCalledWith(
    '1',
    { owner: GONE, generation: '4' },
    startedAt + 1_000,
    'Lease owner left'
  );
  expect(claim).toHaveBeenCalledTimes(2);
  const [leaseOwner, nowMs, leaseExpiresAtMs] = claim.mock.lastCall!;
  expect(leaseOwner).toBe('exchange-live:here');
  expect(leaseExpiresAtMs).toBe(nowMs + 300_000);
  expect(forwarded).toHaveLength(1);
  expect(queueAttemptOf(forwarded[0])?.leaseOwner).toBe('exchange-live:here');
});

it('keeps a claim while the page that holds it is open, watching it once', async () => {
  const owner = liveOwner(() => new Promise<void>(() => {}));
  const { runner, forwarded, host } = fixture({}, owner);
  host.inspectMutations = vi.fn(async () => [headLeasedBy(GONE)]);
  runner.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(host.inspectMutations).toHaveBeenCalledTimes(3);
  expect(owner.departed).toHaveBeenCalledOnce();
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
  expect(forwarded).toEqual([]);
});

it.each([
  ['a claim made without a lock', headLeasedBy('exchange:old')],
  ['an expired claim', headLeasedBy(GONE, Date.now() - 1)],
  [
    'a native engine that reports no lease',
    { ...headLeasedBy(GONE), lease: undefined },
  ],
])('leaves %s to its lease', async (_case, head) => {
  const { runner, host } = fixture(
    {},
    liveOwner(async () => {})
  );
  host.inspectMutations = vi.fn(async () => [head]);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(host.inspectMutations).toHaveBeenCalledOnce();
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
});

it('looks no more than once per poll, however often the queue wakes', async () => {
  const { runner, host } = fixture(
    {},
    liveOwner(() => new Promise<void>(() => {}))
  );
  host.inspectMutations = vi.fn(async () => [headLeasedBy(GONE)]);
  runner.start();
  await vi.advanceTimersByTimeAsync(0);
  for (let wakeup = 0; wakeup < 5; wakeup += 1) {
    runner.wake();
    await vi.advanceTimersByTimeAsync(1_000);
  }
  expect(host.inspectMutations).toHaveBeenCalledOnce();
});

it('does not look while the head waits out its own backoff', async () => {
  const { runner, forwarded, host } = fixture(
    { shouldRetryMutation: () => true },
    liveOwner(async () => {})
  );
  host.inspectMutations = vi.fn(async () => [headLeasedBy(GONE)]);
  await runner.admit(operation(), enqueue(operation(), '2'), runner.epoch());
  const attempt = queueAttemptOf(forwarded[0])!;
  attempt.response = new Response(null, { status: 503 });
  await runner.settle(
    { operation: forwarded[0], data: savedDraft, stale: false, hasNext: false },
    attempt
  );
  runner.wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(host.inspectMutations).not.toHaveBeenCalled();
});

it('keeps the claim when its page cannot be judged after all', async () => {
  const { runner, host } = fixture(
    {},
    liveOwner(async () => {
      throw new Error('lock request failed');
    })
  );
  host.inspectMutations = vi.fn(async () => [headLeasedBy(GONE)]);
  runner.start();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
});

it('releases the claim the departed page holds once it has gone, not the one first seen', async () => {
  const { runner, host } = fixture(
    {},
    liveOwner(async () => {})
  );
  // The page settled the head it held when it was first seen, and claimed the
  // next mutation (generation 1 again) before it went.
  host.inspectMutations = vi
    .fn<() => Promise<MutationInspection[]>>()
    .mockResolvedValueOnce([headLeasedBy(GONE, Date.now() + 300_000, '1')])
    .mockResolvedValue([headLeasedBy(GONE, Date.now() + 300_000, '1', '5')]);
  runner.start();
  await vi.advanceTimersByTimeAsync(1_001);
  expect(
    vi
      .mocked(host.deferOptimisticWrite)
      .mock.calls.map((call) => call.slice(0, 2))
  ).toEqual([['5', { owner: GONE, generation: '1' }]]);
});

it('watches the claim that took the head from a refused release at once', async () => {
  const OTHER = 'exchange-live:other';
  const { runner, host } = fixture(
    {},
    liveOwner(async () => {})
  );
  host.inspectMutations = vi
    .fn<() => Promise<MutationInspection[]>>()
    .mockResolvedValueOnce([headLeasedBy(GONE)])
    .mockResolvedValueOnce([headLeasedBy(GONE)])
    .mockResolvedValue([headLeasedBy(OTHER, Date.now() + 300_000, '5')]);
  vi.mocked(host.deferOptimisticWrite).mockRejectedValueOnce(
    new Error('stale mutation claim')
  );
  const claim = vi.spyOn(host, 'claimNextMutation');
  runner.start();
  await vi.advanceTimersByTimeAsync(2_001);
  expect(
    vi.mocked(host.deferOptimisticWrite).mock.calls.map((call) => call[1])
  ).toEqual([
    { owner: GONE, generation: '4' },
    { owner: OTHER, generation: '5' },
  ]);
  expect(claim).toHaveBeenCalledTimes(2);
});

it('reports a refused release whose claim has left the head, and drains at once', async () => {
  const releases: unknown[] = [];
  const telemetry: MutationQueueTelemetry = {
    ...NOOP_MUTATION_QUEUE_TELEMETRY,
    releaseLease: async (_lease, release) => {
      const outcome = await release();
      releases.push(outcome);
      return outcome;
    },
  };
  const { runner, host } = fixture(
    { mutationQueueTelemetry: telemetry },
    liveOwner(async () => {})
  );
  // Another page released the claim between this page's look and its release.
  host.inspectMutations = vi
    .fn<() => Promise<MutationInspection[]>>()
    .mockResolvedValueOnce([headLeasedBy(GONE)])
    .mockResolvedValueOnce([headLeasedBy(GONE)])
    .mockResolvedValue([{ ...headLeasedBy(GONE), lease: undefined }]);
  vi.mocked(host.deferOptimisticWrite).mockRejectedValueOnce(
    new Error('stale claim for optimistic transaction 1')
  );
  const claim = vi.spyOn(host, 'claimNextMutation');
  runner.start();
  await vi.advanceTimersByTimeAsync(1_001);
  expect(releases).toEqual(['moved']);
  expect(claim).toHaveBeenCalledTimes(2);
});

it('reports a release that failed while its claim still held the head, and tries again at the next poll', async () => {
  const releases: unknown[] = [];
  const telemetry: MutationQueueTelemetry = {
    ...NOOP_MUTATION_QUEUE_TELEMETRY,
    releaseLease: async (_lease, release) => {
      const released = await release();
      releases.push(released);
      return released;
    },
  };
  const { runner, host } = fixture(
    { mutationQueueTelemetry: telemetry },
    liveOwner(async () => {})
  );
  let leased = true;
  host.inspectMutations = vi.fn(async () => [
    leased ? headLeasedBy(GONE) : { ...headLeasedBy(GONE), lease: undefined },
  ]);
  vi.mocked(host.deferOptimisticWrite)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockImplementationOnce(async () => {
      leased = false;
      return { kind: 'deferred' };
    });
  const claim = vi.spyOn(host, 'claimNextMutation');
  runner.start();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(releases).toEqual(['failed']);
  // It looked after the grace and once more after the release, and the same
  // claim still held the head.
  expect(host.inspectMutations).toHaveBeenCalledTimes(3);
  expect(claim).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_001);
  expect(releases).toEqual(['failed', 'released']);
  // The release woke the queue at once.
  expect(claim).toHaveBeenCalledTimes(3);
});

it('hands back a claim whose owner the page let go while it waited for admission', async () => {
  let shown = true;
  const owner: MutationQueueOwner = {
    claimOwner: () => 'exchange-live:here:0',
    holds: (claimedAs) => shown || !claimedAs.startsWith('exchange-live:'),
    departed: () => undefined,
    dispose: () => {},
  };
  const { runner, forwarded, host } = fixture(
    {
      beforeMutationAttempt: async () => {
        shown = false;
        return true;
      },
    },
    owner
  );
  await runner.admit(operation(), enqueue(operation(), '2'), runner.epoch());
  expect(forwarded).toEqual([]);
  expect(host.deferOptimisticWrite).toHaveBeenCalledWith(
    '1',
    { owner: 'exchange-live:here:0', generation: '2' },
    expect.any(Number),
    'Admission deferred'
  );
});
