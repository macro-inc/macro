import {
  PostChannelMessageDocument,
  SaveEmailDraftDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  isGraphqlMutationBackPressure,
  shouldRetryGraphqlMutation,
} from '@service-storage/graphql-mutation-retry';
import {
  CombinedError,
  createClient,
  createRequest,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { getOperationAST, parse } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe, type Subject } from 'wonka';
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
function fixture(options: MutationQueueRunnerDeps['options'] = {}) {
  const forwarded: Operation[] = [];
  // Each request the client sent, ending its wait when answered.
  const replies = new Map<Operation, Subject<OperationResult>>();
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
              const reply = makeSubject<OperationResult>();
              replies.set(op, reply);
              return reply.source;
            })
          ),
      ],
    }),
    options,
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
  return { runner, forwarded, replies, commit, host };
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

describe('a channel write the server keeps turning away', () => {
  const post = () =>
    makeOperation(
      'mutation',
      createRequest(parse(stringifyDocument(PostChannelMessageDocument)), {
        input: { channelId: 'channel', id: 'message', content: 'Hello' },
      }),
      { url: 'http://test', requestPolicy: 'cache-first' }
    );
  const refusal = (code: string) =>
    new CombinedError({
      graphQLErrors: [{ message: 'refused', extensions: { code } }],
    });
  const transportFailure = () =>
    new CombinedError({ networkError: new TypeError('Failed to fetch') });
  const accepted = {
    postChannelMessage: { seq: 1, message: { id: 'message' } },
  };

  // The real runner and retry policy over a durable queue that keeps the
  // write's server failure tally across claims, as the engine does.
  function durableWrite() {
    const fx = fixture({
      shouldRetryMutation: shouldRetryGraphqlMutation,
      isMutationBackPressure: isGraphqlMutationBackPressure,
    });
    const op = post();
    const queue = { serverFailures: 0, retryAt: 0, claims: 0 };
    Object.assign(fx.host, {
      claimNextMutation: async (_owner: string, now: number) => {
        const settled =
          fx.commit.mock.calls.length > 0 ||
          vi.mocked(fx.host.rollbackOptimisticWrite).mock.calls.length > 0;
        if (settled || queue.retryAt > now) return undefined;
        queue.claims += 1;
        return {
          transactionId: '1',
          uuid: 'message',
          query: stringifyDocument(op.query),
          operationName: 'PostChannelMessage',
          variables: op.variables ?? {},
          leaseGeneration: String(queue.claims),
          attemptCount: queue.claims,
          serverFailureCount: queue.serverFailures,
          superseded: false,
          requiresConfirmation: false,
        } satisfies ClaimedMutation;
      },
      deferOptimisticWrite: vi.fn(
        async (
          _transactionId: string,
          _claim: unknown,
          retryAt: number,
          _message: string,
          serverFailure: boolean
        ) => {
          queue.retryAt = retryAt;
          if (serverFailure) queue.serverFailures += 1;
          return { kind: 'deferred' };
        }
      ),
    });
    fx.runner.start();
    // Each round waits out the longest backoff, so the queue reclaims the
    // write, then answers the attempt it sent, as the exchange does.
    const answer = async (
      response: Pick<OperationResult, 'data' | 'error'>
    ) => {
      await vi.advanceTimersByTimeAsync(60_000);
      const sent = fx.forwarded.at(-1)!;
      const settled = await fx.runner.settle(
        { operation: sent, stale: false, hasNext: false, ...response },
        queueAttemptOf(sent)!
      );
      fx.replies.get(sent)?.next(settled);
      return optimisticMutationDispositionOf(settled)?.kind;
    };
    return { ...fx, queue, answer };
  }

  it('stays queued through more BUSY answers than the failure budget, then commits', async () => {
    const { answer, queue, commit, host } = durableWrite();
    for (let attempt = 0; attempt < 15; attempt++) {
      expect(await answer({ error: refusal('BUSY') })).toBe('queued');
    }
    expect(queue.serverFailures).toBe(0);
    expect(await answer({ data: accepted })).toBe('committed');
    expect(queue.claims).toBe(16);
    expect(commit).toHaveBeenCalledOnce();
    expect(host.rollbackOptimisticWrite).not.toHaveBeenCalled();
  });

  it('stays queued through a long run of transport failures, then commits', async () => {
    const { answer, queue, commit, host } = durableWrite();
    for (let attempt = 0; attempt < 15; attempt++) {
      expect(await answer({ error: transportFailure() })).toBe('queued');
    }
    expect(queue.serverFailures).toBe(0);
    expect(await answer({ data: accepted })).toBe('committed');
    expect(commit).toHaveBeenCalledOnce();
    expect(host.rollbackOptimisticWrite).not.toHaveBeenCalled();
  });

  it.each(['FORBIDDEN', 'NOT_FOUND', 'BAD_USER_INPUT', 'INTERNAL_SERVER_ERROR'])(
    'fails for good on a %s refusal, even after BUSY answers',
    async (code) => {
      const { answer, commit, host } = durableWrite();
      expect(await answer({ error: refusal('BUSY') })).toBe('queued');
      expect(await answer({ error: refusal(code) })).toBe(
        'permanently-failed'
      );
      expect(host.rollbackOptimisticWrite).toHaveBeenCalledWith(
        '1',
        expect.anything(),
        expect.any(String),
        code
      );
      expect(commit).not.toHaveBeenCalled();
    }
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
