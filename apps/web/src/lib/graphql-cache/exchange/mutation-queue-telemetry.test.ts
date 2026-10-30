import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaimedMutation } from '../protocol';
import {
  classifyMutationFailure,
  createMutationQueueTelemetry,
  errorCodeAttribute,
  MUTATION_QUEUE_SUMMARY_INTERVAL_MS,
  type MutationQueueEnvironment,
  queueItemAge,
  recoverySkipReason,
  reportMutationQueueCleared,
} from './mutation-queue-telemetry';

const telemetry = vi.hoisted(() => {
  type Recorded = {
    name: string;
    attributes: Record<string, unknown>;
    events: string[];
    errors: unknown[];
    ended: boolean;
  };
  const spans: Recorded[] = [];
  const makeSpan = (name: string) => {
    const recorded: Recorded = {
      name,
      attributes: {},
      events: [],
      errors: [],
      ended: false,
    };
    spans.push(recorded);
    return {
      recorded,
      setAttr: (key: string, value: unknown) => {
        recorded.attributes[key] = value;
      },
      event: (event: string) => recorded.events.push(event),
      error: (error: unknown) => recorded.errors.push(error),
      run: <T>(work: () => T) => work(),
      end: () => {
        recorded.ended = true;
      },
    };
  };
  return {
    spans,
    warn: vi.fn(),
    info: vi.fn(),
    span: vi.fn(
      (name: string, work?: (span: ReturnType<typeof makeSpan>) => unknown) => {
        const span = makeSpan(name);
        if (!work) return span;
        return Promise.resolve(work(span)).finally(span.end);
      }
    ),
  };
});

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: telemetry.span,
    warn: telemetry.warn,
    info: telemetry.info,
  },
}));

const environment: MutationQueueEnvironment = {
  authenticated: true,
  online: true,
  websocket: 'connected',
};

function claimed(overrides: Partial<ClaimedMutation> = {}): ClaimedMutation {
  return {
    transactionId: '7',
    uuid: 'item-1',
    superseded: false,
    requiresConfirmation: false,
    leaseGeneration: '1',
    query: 'mutation SaveEmailDraft { saveEmailDraft }',
    operationName: 'SaveEmailDraft',
    variables: { input: { body: 'private draft body', to: 'a@example.com' } },
    attemptCount: 1,
    serverFailureCount: 0,
    ...overrides,
  };
}

function graphQLError(code: unknown, path: string[] = ['field']) {
  return new CombinedError({
    graphQLErrors: [{ message: 'failed', extensions: { code }, path }],
  });
}

let now = 0;
function create() {
  return createMutationQueueTelemetry({
    environment: () => environment,
    now: () => now,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 1_000;
  telemetry.spans.length = 0;
  telemetry.warn.mockClear();
  telemetry.info.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('classifyMutationFailure', () => {
  it.each([
    ['HTTP 401', undefined, 401, 'auth'],
    ['HTTP 409', undefined, 409, 'conflict'],
    ['HTTP 502', undefined, 502, 'server'],
    ['HTTP 422', undefined, 422, 'validation'],
    ['local code', graphQLError('LOCAL_RECOVERY_FAILED'), undefined, 'local'],
    ['UNAUTHENTICATED', graphQLError('UNAUTHENTICATED'), undefined, 'auth'],
    ['FORBIDDEN', graphQLError('FORBIDDEN'), undefined, 'auth'],
    ['CONFLICT', graphQLError('CONFLICT'), undefined, 'conflict'],
    ['DRAFT_ALREADY_SENT', graphQLError('DRAFT_ALREADY_SENT'), 200, 'conflict'],
    ['INTERNAL', graphQLError('INTERNAL_SERVER_ERROR'), 200, 'server'],
    ['INVALID_INPUT', graphQLError('INVALID_INPUT'), 200, 'validation'],
    ['BAD_USER_INPUT', graphQLError('BAD_USER_INPUT'), 200, 'validation'],
    ['parse error', graphQLError(undefined, []), 200, 'validation'],
    ['NOT_FOUND', graphQLError('NOT_FOUND'), 200, 'graphql'],
    [
      'timeout',
      new CombinedError({
        networkError: Object.assign(new Error('signal timed out'), {
          name: 'TimeoutError',
        }),
      }),
      undefined,
      'timeout',
    ],
    [
      'offline',
      new CombinedError({ networkError: new TypeError('Failed to fetch') }),
      undefined,
      'network',
    ],
    ['empty payload', undefined, 200, 'no-data'],
  ] as const)('%s', (_label, error, status, expected) => {
    expect(classifyMutationFailure(error, status)).toBe(expected);
  });

  it('treats the server auth message as auth without a code', () => {
    const error = new CombinedError({
      graphQLErrors: [{ message: 'authentication required', path: ['x'] }],
    });
    expect(classifyMutationFailure(error, 200)).toBe('auth');
  });
});

describe('errorCodeAttribute', () => {
  it('keeps identifier codes and replaces anything that could carry text', () => {
    expect(errorCodeAttribute('MUTATION_RETRY_EXHAUSTED')).toBe(
      'MUTATION_RETRY_EXHAUSTED'
    );
    expect(errorCodeAttribute('draft for a@example.com')).toBe('UNRECOGNIZED');
    expect(errorCodeAttribute(42)).toBe('UNRECOGNIZED');
    expect(errorCodeAttribute(undefined)).toBeUndefined();
  });
});

describe('recoverySkipReason', () => {
  it.each([
    ['Sign in to save drafts on this device.', 'recovery-signed-out'],
    [
      'This draft session is no longer active. Reload Macro.',
      'recovery-session-inactive',
    ],
    ['Queue inspection is unavailable', 'recovery-inspection-unavailable'],
    ['Mutation recovery timed out', 'recovery-timeout'],
    ['IndexedDB unavailable', 'recovery-failed'],
  ] as const)('%s', (message, reason) => {
    expect(recoverySkipReason(new Error(message))).toBe(reason);
  });
});

describe('createMutationQueueTelemetry', () => {
  it('records one attempt span with ids, counts, and outcome only', () => {
    const queue = create();
    queue
      .enqueue({ uuid: 'item-1', operationName: 'SaveEmailDraft' })
      .persisted({
        transactionId: '7',
        replaced: false,
        claimed: true,
        linkPatchesDegraded: false,
      });
    now = 1_200;
    const attempt = queue.attempt(claimed({ enqueuedAtMs: 1_000 }));
    attempt.sent('live');
    now = 1_500;
    attempt.finish('committed');
    attempt.finish('rolled-back');

    const span = telemetry.spans.find(
      (span) => span.name === 'graphql.mutation_queue.attempt'
    );
    expect(span?.ended).toBe(true);
    expect(span?.attributes).toMatchObject({
      'mutation_queue.item_id': 'item-1',
      'mutation_queue.transaction_id': '7',
      'graphql.operation.name': 'SaveEmailDraft',
      'mutation_queue.attempt_count': 1,
      'auth.state': 'signed-in',
      'network.online': true,
      'graphql.websocket.state': 'connected',
      'mutation_queue.pending_items': 1,
      'mutation_queue.recovered': false,
      'mutation_queue.send_mode': 'live',
      'mutation_queue.outcome': 'committed',
      'mutation_queue.attempt_ms': 300,
      'mutation_queue.end_to_end_ms': 500,
      'mutation_queue.item_age_ms': 500,
      'mutation_queue.age_known': true,
    });
    const exported = JSON.stringify(telemetry.spans);
    expect(exported).not.toContain('private draft body');
    expect(exported).not.toContain('a@example.com');
    expect(telemetry.warn).not.toHaveBeenCalled();
  });

  it('replaces an operation name that is not an identifier', () => {
    create()
      .attempt(claimed({ operationName: 'mutation { secret }' }))
      .finish('committed');
    expect(telemetry.spans[0]?.attributes['graphql.operation.name']).toBe(
      'unknown'
    );
  });

  it('logs the first retry per item and failure class, then only counts', () => {
    const queue = create();
    for (let attemptCount = 1; attemptCount <= 5; attemptCount++) {
      queue
        .attempt(claimed({ attemptCount }))
        .finish('retry-scheduled', { failure: 'network', retryDelayMs: 1_000 });
    }
    expect(telemetry.warn).toHaveBeenCalledOnce();
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.retry_scheduled',
      expect.objectContaining({
        'mutation_queue.item_id': 'item-1',
        'mutation_queue.failure': 'network',
      })
    );

    queue
      .attempt(claimed({ attemptCount: 6 }))
      .finish('retry-scheduled', { failure: 'server', httpStatus: 503 });
    queue.attempt(claimed({ uuid: 'item-2' })).finish('retry-scheduled', {
      failure: 'network',
    });
    expect(telemetry.warn).toHaveBeenCalledTimes(3);

    queue.attempt(claimed({ attemptCount: 7 })).finish('committed');
    expect(telemetry.info).toHaveBeenCalledWith(
      'graphql.mutation_queue.committed_after_failure',
      expect.objectContaining({ 'mutation_queue.item_id': 'item-1' })
    );
  });

  it('summarizes repeated failures once per interval', async () => {
    const queue = create();
    for (let attemptCount = 1; attemptCount <= 3; attemptCount++) {
      queue.attempt(claimed({ attemptCount })).finish('retry-scheduled', {
        failure: 'auth',
        httpStatus: 401,
      });
    }
    telemetry.warn.mockClear();
    now += MUTATION_QUEUE_SUMMARY_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);

    expect(telemetry.warn).toHaveBeenCalledOnce();
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.summary',
      expect.objectContaining({
        'mutation_queue.count.attempt.retry-scheduled': 3,
        'mutation_queue.count.failure.auth': 3,
        'mutation_queue.pending_items': 1,
        'mutation_queue.max_attempt_count': 3,
      })
    );
  });

  it('stays quiet when an interval only had routine successes', async () => {
    const queue = create();
    queue.attempt(claimed()).finish('committed');
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(telemetry.warn).not.toHaveBeenCalled();
  });

  it('logs a skip reason once and backs off summaries while it repeats', async () => {
    const queue = create();
    const summaries = () =>
      telemetry.warn.mock.calls.filter(
        ([message]) => message === 'graphql.mutation_queue.summary'
      );
    queue.skipped('recovery-session-inactive');
    queue.skipped('recovery-session-inactive');
    expect(telemetry.warn).toHaveBeenCalledOnce();
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.skipped',
      expect.objectContaining({
        'mutation_queue.skip_reason': 'recovery-session-inactive',
      })
    );

    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]?.[1]).toMatchObject({
      'mutation_queue.count.skip.recovery-session-inactive': 2,
      'mutation_queue.summary_interval_ms': MUTATION_QUEUE_SUMMARY_INTERVAL_MS,
    });

    queue.skipped('recovery-session-inactive');
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(summaries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1]?.[1]).toMatchObject({
      'mutation_queue.summary_interval_ms':
        2 * MUTATION_QUEUE_SUMMARY_INTERVAL_MS,
    });
  });

  it('counts a deferred admission without opening a span', () => {
    create().attempt(claimed()).finish('deferred');
    expect(telemetry.spans).toHaveLength(0);
  });

  it('reports a pending item that stays queued past a minute', async () => {
    const queue = create();
    queue.attempt(claimed()).finish('deferred');
    now += MUTATION_QUEUE_SUMMARY_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    const [, summary] = telemetry.warn.mock.calls[0] ?? [];
    expect(summary).toMatchObject({
      'mutation_queue.count.attempt.deferred': 1,
      'mutation_queue.oldest_observed_wait_ms':
        MUTATION_QUEUE_SUMMARY_INTERVAL_MS,
      'mutation_queue.age_unknown_items': 1,
    });
    expect(summary).not.toHaveProperty('mutation_queue.oldest_item_age_ms');
  });

  it('measures age from the durable enqueue time across a reload', async () => {
    const queue = create();
    now = 600_000;
    const attempt = queue.attempt(
      claimed({ enqueuedAtMs: 100_000, attemptCount: 4 })
    );
    attempt.finish('deferred');
    expect(telemetry.spans).toHaveLength(0);
    queue
      .attempt(claimed({ enqueuedAtMs: 100_000, attemptCount: 5 }))
      .finish('committed');
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'mutation_queue.recovered': true,
      'mutation_queue.observed_wait_ms': 0,
      'mutation_queue.item_age_ms': 500_000,
      'mutation_queue.end_to_end_ms': 500_000,
      'mutation_queue.age_known': true,
    });
  });

  it('summarizes an old recovered item even without an observed wait', async () => {
    const queue = create();
    now = 600_000;
    queue.attempt(claimed({ enqueuedAtMs: 100_000 })).finish('deferred');
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.summary',
      expect.objectContaining({
        'mutation_queue.oldest_item_age_ms': 500_000,
        'mutation_queue.oldest_observed_wait_ms': 0,
        'mutation_queue.age_unknown_items': 0,
      })
    );
  });

  it('prefers the stored queue sample in a summary', async () => {
    const queue = create();
    now = 600_000;
    queue.loaded(async () => [
      { enqueuedAtMs: 200_000 },
      { enqueuedAtMs: 590_000 },
      {},
    ]);
    queue
      .attempt(claimed({ enqueuedAtMs: 590_000 }))
      .finish('retry-scheduled', { failure: 'network' });
    telemetry.warn.mockClear();
    await vi.advanceTimersByTimeAsync(MUTATION_QUEUE_SUMMARY_INTERVAL_MS);
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.summary',
      expect.objectContaining({
        'mutation_queue.depth': 3,
        'mutation_queue.pending_items': 1,
        'mutation_queue.oldest_item_age_ms': 400_000,
        'mutation_queue.age_unknown_items': 1,
      })
    );
  });

  it.each([
    ['missing', undefined, 'missing'],
    ['zero', 0, 'invalid'],
    ['fractional', 1.5, 'invalid'],
    ['in the future', 2_000, 'clock-skew'],
    ['negative', -400 * 24 * 60 * 60_000, 'invalid'],
  ] as const)(
    'reports a %s enqueue time as an unknown age',
    (_label, enqueuedAtMs, reason) => {
      create()
        .attempt(claimed({ enqueuedAtMs }))
        .finish('retry-exhausted', { failure: 'server', httpStatus: 503 });
      const attributes = telemetry.spans[0]?.attributes;
      expect(attributes).toMatchObject({
        'mutation_queue.age_known': false,
        'mutation_queue.age_unknown_reason': reason,
      });
      expect(attributes).not.toHaveProperty('mutation_queue.item_age_ms');
      expect(attributes).not.toHaveProperty('mutation_queue.end_to_end_ms');
    }
  );

  it('flags an age past a year as clock skew', () => {
    now = 400 * 24 * 60 * 60_000;
    create()
      .attempt(claimed({ enqueuedAtMs: 1 }))
      .finish('committed');
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'mutation_queue.age_known': false,
      'mutation_queue.age_unknown_reason': 'clock-skew',
    });
  });

  it('logs how long an item waited before the queue gave up', () => {
    now = 90_000;
    create()
      .attempt(claimed({ enqueuedAtMs: 10_000, serverFailureCount: 5 }))
      .finish('retry-exhausted', { failure: 'server', httpStatus: 503 });
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.retry_exhausted',
      expect.objectContaining({
        'mutation_queue.item_age_ms': 80_000,
        'mutation_queue.end_to_end_ms': 80_000,
        'mutation_queue.age_known': true,
      })
    );
  });

  it('tracks a replacement as unknown until a claim reports its time', () => {
    const queue = create();
    queue
      .enqueue({ uuid: 'item-1', operationName: 'SaveEmailDraft' })
      .persisted({
        transactionId: '8',
        replaced: true,
        claimed: false,
        linkPatchesDegraded: false,
      });
    expect(
      telemetry.spans.find(
        (span) => span.name === 'graphql.mutation_queue.enqueue'
      )?.attributes
    ).toMatchObject({ 'mutation_queue.age_unknown_items': 1 });
  });

  it('logs an enqueue failure once per reason', () => {
    const queue = create();
    queue.enqueue({ operationName: 'SaveEmailDraft' }).failed('uncertain');
    queue.enqueue({ operationName: 'SaveEmailDraft' }).failed('uncertain');
    expect(telemetry.warn).toHaveBeenCalledOnce();
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.enqueue_failed',
      expect.objectContaining({ 'mutation_queue.enqueue_failure': 'uncertain' })
    );
    expect(
      telemetry.spans.every((span) => span.ended && span.errors.length === 1)
    ).toBe(true);
  });

  it('samples the persisted queue on load', async () => {
    now = 50_000;
    create().loaded(async () => [
      { enqueuedAtMs: 20_000 },
      { enqueuedAtMs: 45_000 },
      {},
      { enqueuedAtMs: 60_000 },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const loaded = {
      'mutation_queue.depth': 4,
      'mutation_queue.oldest_item_age_ms': 30_000,
      'mutation_queue.age_unknown_items': 2,
    };
    expect(telemetry.spans[0]).toMatchObject({
      name: 'graphql.mutation_queue.loaded',
      attributes: loaded,
      ended: true,
    });
    expect(telemetry.info).toHaveBeenCalledWith(
      'graphql.mutation_queue.loaded',
      expect.objectContaining(loaded)
    );
  });

  it('omits the oldest age on load when no age is known', async () => {
    create().loaded(async () => [{}]);
    await vi.advanceTimersByTimeAsync(0);
    expect(telemetry.spans[0]?.attributes).toMatchObject({
      'mutation_queue.depth': 1,
      'mutation_queue.age_unknown_items': 1,
    });
    expect(telemetry.spans[0]?.attributes).not.toHaveProperty(
      'mutation_queue.oldest_item_age_ms'
    );
  });
});

describe('queueItemAge', () => {
  it.each([
    [undefined, { known: false, reason: 'missing' }],
    [null, { known: false, reason: 'missing' }],
    ['100', { known: false, reason: 'invalid' }],
    [-5, { known: false, reason: 'invalid' }],
    [Number.MAX_SAFE_INTEGER + 2, { known: false, reason: 'invalid' }],
    [1_001, { known: false, reason: 'clock-skew' }],
    [1_000, { known: true, ageMs: 0 }],
    [400, { known: true, ageMs: 600 }],
  ] as const)('%s', (enqueuedAtMs, expected) => {
    expect(queueItemAge(enqueuedAtMs, 1_000)).toEqual(expected);
  });
});

describe('reportMutationQueueCleared', () => {
  it('lists each lost item with its wait, oldest first', () => {
    reportMutationQueueCleared(
      [
        { operationName: 'SaveEmailDraft', enqueuedAtMs: 9_000 },
        { operationName: 'mutation { secret }' },
        { operationName: 'SetEntityProperty', enqueuedAtMs: 1_000 },
        { operationName: 'SaveEmailDraft', enqueuedAtMs: 20_000 },
      ],
      'logout',
      10_000
    );
    expect(telemetry.warn).toHaveBeenCalledWith(
      'graphql.mutation_queue.cleared',
      {
        'mutation_queue.clear_cause': 'logout',
        'mutation_queue.depth': 4,
        'mutation_queue.operation_names':
          'SaveEmailDraft,SetEntityProperty,unknown',
        'mutation_queue.items':
          'SetEntityProperty:9000,SaveEmailDraft:1000,unknown:unknown,SaveEmailDraft:unknown',
        'mutation_queue.oldest_item_age_ms': 9_000,
        'mutation_queue.age_unknown_items': 2,
      }
    );
  });

  it('caps the item list', () => {
    reportMutationQueueCleared(
      Array.from({ length: 30 }, (_, index) => ({
        operationName: 'SaveEmailDraft',
        enqueuedAtMs: 1_000 + index,
      })),
      'session-expired',
      10_000
    );
    const [, attributes] = telemetry.warn.mock.calls[0] ?? [];
    expect(
      String(attributes?.['mutation_queue.items']).split(',')
    ).toHaveLength(20);
    expect(attributes?.['mutation_queue.depth']).toBe(30);
  });
});
