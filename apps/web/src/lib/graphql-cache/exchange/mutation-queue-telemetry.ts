/**
 * Telemetry for the durable GraphQL mutation queue.
 *
 * Each claimed attempt is one `graphql.mutation_queue.attempt` span. Its fetch
 * runs inside the span, so `graphql.transport` and the server's request and
 * `graphql.execute` spans join the attempt's trace through `traceparent`.
 *
 * Logs are bounded. An item logs the first occurrence of each outcome and
 * failure class, and the queue logs the first occurrence of each skip reason.
 * Repeats only increment counters, which a summary reports at most once per
 * interval while something other than routine success happened.
 *
 * Attributes are opaque ids, counts, durations, and fixed classes. Variables,
 * responses, and error messages never leave this module.
 *
 * Item ages come from the durable enqueue time, so they survive reloads. When
 * that time is missing or implausible, `mutation_queue.age_known` is false
 * and the age is omitted rather than reported as zero.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { CombinedError } from '@urql/core';
import type { ClaimedMutation } from '../protocol';

export type MutationQueueEnvironment = {
  authenticated: boolean;
  online: boolean;
  websocket: 'connecting' | 'connected' | 'disconnected' | 'none';
};

export type MutationFailureClass =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'server'
  | 'conflict'
  | 'validation'
  | 'graphql'
  | 'no-data'
  | 'local';

export type MutationAttemptOutcome =
  /** The server confirmed the mutation and the cache committed it. */
  | 'committed'
  /** A retryable failure; the head stays queued with a backoff. */
  | 'retry-scheduled'
  /** A permanent failure; the optimistic state was rolled back. */
  | 'rolled-back'
  /** A newer write for the same record replaced this one. */
  | 'superseded'
  /** Too many server failures; the queue gave up and rolled back. */
  | 'retry-exhausted'
  /** Settlement failed after sending; the lease backoff decides later. */
  | 'ack-lost'
  /** A storage reset retired the attempt before it settled. */
  | 'detached'
  /** Admission could not judge the intent yet; it is asked again shortly. */
  | 'deferred'
  /** Admission discarded obsolete local intent without sending it. */
  | 'discarded'
  /** Startup recovery for the head failed; the head was rolled back. */
  | 'recovery-failed';

export type MutationQueueSkipReason =
  | 'host-disabled'
  | 'claim-failed'
  | 'recovery-signed-out'
  | 'recovery-session-inactive'
  | 'recovery-inspection-unavailable'
  | 'recovery-timeout'
  | 'recovery-failed';

export type MutationEnqueueFailure =
  /** The queue may hold the write; the caller cannot safely retry. */
  | 'uncertain'
  | 'storage-changed'
  /** Another context holds the database; the mutation went straight out. */
  | 'owner-lock'
  /** The engine refused the write; the mutation went straight out. */
  | 'rejected';

export type MutationAttemptDetails = {
  failure?: MutationFailureClass;
  /** Sanitized before export; any non-identifier becomes `UNRECOGNIZED`. */
  errorCode?: unknown;
  httpStatus?: number;
  retryDelayMs?: number;
};

export interface MutationAttemptTelemetry {
  /** Runs the network send so its spans join this attempt's trace. */
  run<T>(send: () => T): T;
  sent(mode: 'live' | 'replay'): void;
  /** Ends the attempt; later calls are ignored. */
  finish(
    outcome: MutationAttemptOutcome,
    details?: MutationAttemptDetails
  ): void;
}

export interface MutationEnqueueTelemetry {
  persisted(result: {
    transactionId: string;
    /** Replaced an unsent write for the same record. */
    replaced: boolean;
    /** Claimed as the queue head in the same call. */
    claimed: boolean;
    /** Persisted without its list patches after the engine rejected them. */
    linkPatchesDegraded: boolean;
  }): void;
  failed(reason: MutationEnqueueFailure): void;
}

export type QueuedItemTiming = { enqueuedAtMs?: number };

export interface MutationQueueTelemetry {
  /**
   * Samples the persisted queue once when the runner starts; summaries
   * sample it again through the same callback.
   */
  loaded(
    inspect: () => Promise<ReadonlyArray<QueuedItemTiming> | undefined>
  ): void;
  enqueue(item: {
    uuid?: string;
    operationName?: string;
  }): MutationEnqueueTelemetry;
  attempt(mutation: ClaimedMutation): MutationAttemptTelemetry;
  skipped(reason: MutationQueueSkipReason): void;
  storageReset(): void;
}

export const NOOP_MUTATION_ATTEMPT_TELEMETRY: MutationAttemptTelemetry = {
  run: (send) => send(),
  sent: () => undefined,
  finish: () => undefined,
};

const NOOP_ENQUEUE: MutationEnqueueTelemetry = {
  persisted: () => undefined,
  failed: () => undefined,
};

export const NOOP_MUTATION_QUEUE_TELEMETRY: MutationQueueTelemetry = {
  loaded: () => undefined,
  enqueue: () => NOOP_ENQUEUE,
  attempt: () => NOOP_MUTATION_ATTEMPT_TELEMETRY,
  skipped: () => undefined,
  storageReset: () => undefined,
};

export const MUTATION_QUEUE_SUMMARY_INTERVAL_MS = 5 * 60_000;
/** A tab that only keeps skipping backs its summaries off to this interval. */
const MAX_SUMMARY_INTERVAL_MS = 60 * 60_000;
/** A pending item older than this makes the summary worth reporting. */
const STUCK_ITEM_AGE_MS = 60_000;
/** Bounds per-item log keys for a tab that never settles its items. */
const MAX_LOGGED_KEYS = 1_000;
/** A longer wait means the clock was wrong at enqueue, not a real wait. */
const MAX_PLAUSIBLE_AGE_MS = 365 * 24 * 60 * 60_000;
const MAX_CLEARED_ITEMS = 20;

export type QueueItemAge =
  | { known: true; ageMs: number }
  | { known: false; reason: 'missing' | 'invalid' | 'clock-skew' };

/**
 * Age of a durable enqueue time. Older hosts omit the time and a wall clock
 * can move backwards, so an age is either trustworthy or unknown, never a
 * stand-in zero.
 */
export function queueItemAge(
  enqueuedAtMs: unknown,
  nowMs: number
): QueueItemAge {
  if (enqueuedAtMs === undefined || enqueuedAtMs === null)
    return { known: false, reason: 'missing' };
  if (
    typeof enqueuedAtMs !== 'number' ||
    !Number.isSafeInteger(enqueuedAtMs) ||
    enqueuedAtMs <= 0
  )
    return { known: false, reason: 'invalid' };
  const ageMs = nowMs - enqueuedAtMs;
  if (ageMs < 0 || ageMs > MAX_PLAUSIBLE_AGE_MS)
    return { known: false, reason: 'clock-skew' };
  return { known: true, ageMs };
}

function ageAttributes(
  age: QueueItemAge,
  key: string
): Record<string, string | number | boolean> {
  return age.known
    ? { [key]: age.ageMs, 'mutation_queue.age_known': true }
    : {
        'mutation_queue.age_known': false,
        'mutation_queue.age_unknown_reason': age.reason,
      };
}

/** Oldest known age and the count of items whose age is unknown. */
function oldestAge(
  enqueueTimes: Iterable<unknown>,
  nowMs: number
): Record<string, number> {
  let oldest: number | undefined;
  let unknown = 0;
  for (const enqueuedAtMs of enqueueTimes) {
    const age = queueItemAge(enqueuedAtMs, nowMs);
    if (age.known) oldest = Math.max(oldest ?? 0, age.ageMs);
    else unknown += 1;
  }
  const attributes: Record<string, number> = {
    'mutation_queue.age_unknown_items': unknown,
  };
  if (oldest !== undefined)
    attributes['mutation_queue.oldest_item_age_ms'] = oldest;
  return attributes;
}

const TERMINAL_OUTCOMES: ReadonlySet<MutationAttemptOutcome> = new Set([
  'committed',
  'rolled-back',
  'superseded',
  'retry-exhausted',
  'discarded',
  'recovery-failed',
]);

/** Outcomes that log their first occurrence per item and failure class. */
const LOGGED_OUTCOMES: ReadonlySet<MutationAttemptOutcome> = new Set([
  'retry-scheduled',
  'rolled-back',
  'retry-exhausted',
  'ack-lost',
  'recovery-failed',
]);

/** Counters a summary does not report on their own. */
const ROUTINE_COUNTERS: ReadonlySet<string> = new Set([
  'enqueue.persisted',
  'attempt.started',
  'attempt.committed',
  'attempt.deferred',
  'attempt.discarded',
  'attempt.superseded',
]);

const OPERATION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function operationNameAttribute(name: string | undefined): string {
  return name && OPERATION_NAME.test(name) ? name : 'unknown';
}

/** Server codes are identifiers; anything else may carry input text. */
export function errorCodeAttribute(code: unknown): string | undefined {
  if (code === undefined || code === null) return undefined;
  return typeof code === 'string' && ERROR_CODE.test(code)
    ? code
    : 'UNRECOGNIZED';
}

function graphQLErrorCode(error: CombinedError | undefined): unknown {
  return error?.graphQLErrors[0]?.extensions.code;
}

function detailAttributes(
  details: MutationAttemptDetails,
  errorCode: string | undefined
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {};
  if (details.failure) attributes['mutation_queue.failure'] = details.failure;
  if (errorCode) attributes['graphql.error.code'] = errorCode;
  if (details.httpStatus)
    attributes['http.response.status_code'] = details.httpStatus;
  if (details.retryDelayMs !== undefined)
    attributes['mutation_queue.retry_delay_ms'] = details.retryDelayMs;
  return attributes;
}

/** Classifies a failed attempt without retaining its message. */
export function classifyMutationFailure(
  error: CombinedError | undefined,
  httpStatus: number | undefined
): MutationFailureClass {
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (httpStatus === 409) return 'conflict';
  if (httpStatus !== undefined && httpStatus >= 500) return 'server';
  const graphQLError = error?.graphQLErrors[0];
  if (graphQLError) {
    const code = graphQLErrorCode(error);
    const upper = typeof code === 'string' ? code.toUpperCase() : '';
    if (upper.startsWith('LOCAL_')) return 'local';
    if (
      ['UNAUTHENTICATED', 'UNAUTHORIZED', 'FORBIDDEN'].includes(upper) ||
      graphQLError.message === 'authentication required'
    )
      return 'auth';
    if (upper.includes('CONFLICT') || upper.endsWith('ALREADY_SENT'))
      return 'conflict';
    if (upper.startsWith('INTERNAL')) return 'server';
    if (
      upper === 'BAD_USER_INPUT' ||
      upper.startsWith('INVALID') ||
      upper.startsWith('GRAPHQL_') ||
      // Parse and validation errors have neither a code nor a field path.
      (!upper && !graphQLError.path?.length)
    )
      return 'validation';
    return 'graphql';
  }
  if (httpStatus !== undefined && httpStatus >= 400) return 'validation';
  const networkError = error?.networkError;
  if (networkError) {
    return networkError.name === 'TimeoutError' ||
      networkError.name === 'AbortError' ||
      /timed? ?out/i.test(networkError.message)
      ? 'timeout'
      : 'network';
  }
  return 'no-data';
}

/** Failure attributes for an attempt that did not return usable data. */
export function failureDetails(
  error: CombinedError | undefined,
  response: Response | undefined
): MutationAttemptDetails {
  return {
    failure: classifyMutationFailure(error, response?.status),
    errorCode: error?.networkError ? undefined : graphQLErrorCode(error),
    httpStatus: response?.status,
  };
}

/** Maps a recovery failure to a fixed reason; its message is not exported. */
export function recoverySkipReason(error: unknown): MutationQueueSkipReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Sign in to save drafts')) return 'recovery-signed-out';
  if (message.includes('no longer active')) return 'recovery-session-inactive';
  if (message.includes('Queue inspection is unavailable'))
    return 'recovery-inspection-unavailable';
  if (message.includes('timed out')) return 'recovery-timeout';
  return 'recovery-failed';
}

export type MutationQueueClearCause = 'logout' | 'session-expired';

/**
 * Reports queued mutations a local sign-out is about to delete, with how long
 * each waited: `mutation_queue.items` lists `operation:age_ms`, oldest first,
 * with `unknown` for an item whose age is unknown.
 */
export function reportMutationQueueCleared(
  queue: ReadonlyArray<{ operationName?: string } & QueuedItemTiming>,
  cause: MutationQueueClearCause,
  nowMs = Date.now()
): void {
  if (queue.length === 0) return;
  const operationNames = [
    ...new Set(queue.map((item) => operationNameAttribute(item.operationName))),
  ].sort();
  const items = queue
    .map((item) => ({
      operationName: operationNameAttribute(item.operationName),
      age: queueItemAge(item.enqueuedAtMs, nowMs),
    }))
    .sort(
      (left, right) =>
        (right.age.known ? right.age.ageMs : -1) -
        (left.age.known ? left.age.ageMs : -1)
    )
    .slice(0, MAX_CLEARED_ITEMS)
    .map(
      ({ operationName, age }) =>
        `${operationName}:${age.known ? age.ageMs : 'unknown'}`
    );
  Telemetry.warn('graphql.mutation_queue.cleared', {
    'mutation_queue.clear_cause': cause,
    'mutation_queue.depth': queue.length,
    'mutation_queue.operation_names': operationNames
      .slice(0, MAX_CLEARED_ITEMS)
      .join(','),
    'mutation_queue.items': items.join(','),
    ...oldestAge(
      queue.map((item) => item.enqueuedAtMs),
      nowMs
    ),
  });
}

type TrackedItem = {
  firstSeenAt: number;
  /** Claimed from storage written before this runner started. */
  recovered: boolean;
  /** Durable enqueue time from the host, or this tab's enqueue time. */
  enqueuedAtMs?: number;
};

export function createMutationQueueTelemetry({
  environment,
  now = Date.now,
  summaryIntervalMs = MUTATION_QUEUE_SUMMARY_INTERVAL_MS,
}: {
  environment: () => MutationQueueEnvironment;
  now?: () => number;
  summaryIntervalMs?: number;
}): MutationQueueTelemetry {
  const items = new Map<string, TrackedItem>();
  const loggedKeys = new Set<string>();
  const counters = new Map<string, number>();
  let maxAttemptCount = 0;
  let summaryScheduled = false;
  let nextSummaryIntervalMs = summaryIntervalMs;
  let inspectQueue:
    | (() => Promise<ReadonlyArray<QueuedItemTiming> | undefined>)
    | undefined;

  function environmentAttributes(): Record<string, string | boolean> {
    const current = environment();
    return {
      'auth.state': current.authenticated ? 'signed-in' : 'signed-out',
      'network.online': current.online,
      'graphql.websocket.state': current.websocket,
    };
  }

  /**
   * Items this tab enqueued or claimed. `oldest_item_age_ms` comes from
   * durable enqueue times; `oldest_observed_wait_ms` only covers this tab.
   */
  function queueAttributes(): Record<string, number> {
    const at = now();
    let firstSeen: number | undefined;
    for (const item of items.values())
      firstSeen = Math.min(firstSeen ?? item.firstSeenAt, item.firstSeenAt);
    return {
      'mutation_queue.pending_items': items.size,
      'mutation_queue.oldest_observed_wait_ms':
        firstSeen === undefined ? 0 : Math.max(0, at - firstSeen),
      ...oldestAge(
        [...items.values()].map((item) => item.enqueuedAtMs),
        at
      ),
    };
  }

  function count(key: string): void {
    counters.set(key, (counters.get(key) ?? 0) + 1);
    if (summaryScheduled) return;
    summaryScheduled = true;
    setTimeout(() => {
      summaryScheduled = false;
      fireAndForget(reportSummary(), 'graphql-cache-mutation-queue');
    }, nextSummaryIntervalMs);
  }

  /** Returns true the first time `key` is seen. */
  function firstOccurrence(key: string): boolean {
    if (loggedKeys.has(key)) return false;
    if (loggedKeys.size >= MAX_LOGGED_KEYS) loggedKeys.clear();
    loggedKeys.add(key);
    return true;
  }

  function forgetItem(uuid: string): void {
    items.delete(uuid);
    for (const key of loggedKeys)
      if (key.startsWith(`${uuid}|`)) loggedKeys.delete(key);
  }

  /** Depth and ages across every persisted item, from storage. */
  async function sampleQueue(): Promise<Record<string, number> | undefined> {
    try {
      const queue = await inspectQueue?.();
      if (!queue) return undefined;
      return {
        'mutation_queue.depth': queue.length,
        ...oldestAge(
          queue.map((item) => item.enqueuedAtMs),
          now()
        ),
      };
    } catch {
      return undefined;
    }
  }

  async function reportSummary(): Promise<void> {
    const queue = queueAttributes();
    const stuck =
      Math.max(
        queue['mutation_queue.oldest_item_age_ms'] ?? 0,
        queue['mutation_queue.oldest_observed_wait_ms'] ?? 0
      ) >= STUCK_ITEM_AGE_MS;
    const notable = [...counters.keys()].some(
      (key) => !ROUTINE_COUNTERS.has(key)
    );
    const snapshot = new Map(counters);
    counters.clear();
    const intervalMs = nextSummaryIntervalMs;
    // A signed-out or retired tab skips every poll for as long as it stays
    // open; only a change in queue activity resets the interval.
    nextSummaryIntervalMs = [...snapshot.keys()].every((key) =>
      key.startsWith('skip.')
    )
      ? Math.min(intervalMs * 2, MAX_SUMMARY_INTERVAL_MS)
      : summaryIntervalMs;
    if (!notable && !stuck) return;
    const stored = await sampleQueue();
    // Storage covers items this tab never saw, so its ages replace the tab's.
    const {
      'mutation_queue.oldest_item_age_ms': _trackedOldest,
      'mutation_queue.age_unknown_items': _trackedUnknown,
      ...observed
    } = queue;
    const attributes: Record<string, string | number | boolean> = {
      ...environmentAttributes(),
      ...(stored ? { ...observed, ...stored } : queue),
      'mutation_queue.max_attempt_count': maxAttemptCount,
      'mutation_queue.summary_interval_ms': intervalMs,
    };
    for (const [key, value] of snapshot)
      attributes[`mutation_queue.count.${key}`] = value;
    Telemetry.warn('graphql.mutation_queue.summary', attributes);
  }

  function attempt(mutation: ClaimedMutation): MutationAttemptTelemetry {
    const startedAt = now();
    let item = items.get(mutation.uuid);
    if (!item) {
      item = { firstSeenAt: startedAt, recovered: true };
      items.set(mutation.uuid, item);
    }
    if (mutation.enqueuedAtMs !== undefined)
      item.enqueuedAtMs = mutation.enqueuedAtMs;
    const tracked = item;
    const waited = (at: number) => ({
      'mutation_queue.observed_wait_ms': at - tracked.firstSeenAt,
      ...ageAttributes(
        queueItemAge(tracked.enqueuedAtMs, at),
        'mutation_queue.item_age_ms'
      ),
    });
    maxAttemptCount = Math.max(maxAttemptCount, mutation.attemptCount);
    const operationName = operationNameAttribute(mutation.operationName);
    const identity = {
      'mutation_queue.item_id': mutation.uuid,
      'mutation_queue.transaction_id': mutation.transactionId,
      'graphql.operation.name': operationName,
      'mutation_queue.attempt_count': mutation.attemptCount,
      'mutation_queue.server_failure_count': mutation.serverFailureCount,
    };
    const claimAttributes = {
      ...identity,
      ...environmentAttributes(),
      ...queueAttributes(),
      'mutation_queue.superseded': mutation.superseded,
      'mutation_queue.recovered': tracked.recovered,
      ...waited(startedAt),
    };
    // Opened on first use: a head whose admission keeps deferring is claimed
    // every second and should only count, not emit a span per claim.
    let openedSpan: Span | undefined;
    const span = (): Span => {
      if (openedSpan) return openedSpan;
      openedSpan = Telemetry.span('graphql.mutation_queue.attempt');
      for (const [key, value] of Object.entries(claimAttributes))
        openedSpan.setAttr(key, value);
      return openedSpan;
    };
    count('attempt.started');
    let finished = false;
    return {
      run: (send) => span().run(send),
      sent(mode) {
        span().setAttr('mutation_queue.send_mode', mode);
        span().setAttr('mutation_queue.prepare_ms', now() - startedAt);
        span().event('sent');
      },
      finish(outcome, details = {}) {
        if (finished) return;
        finished = true;
        if (outcome === 'deferred' && !openedSpan) {
          count('attempt.deferred');
          return;
        }
        const finishedAt = now();
        const errorCode = errorCodeAttribute(details.errorCode);
        const age = queueItemAge(tracked.enqueuedAtMs, finishedAt);
        const attributes: Record<string, string | number | boolean> = {
          ...identity,
          'mutation_queue.outcome': outcome,
          'mutation_queue.attempt_ms': finishedAt - startedAt,
          ...waited(finishedAt),
          ...detailAttributes(details, errorCode),
        };
        if (TERMINAL_OUTCOMES.has(outcome) && age.known)
          attributes['mutation_queue.end_to_end_ms'] = age.ageMs;
        const attemptSpan = span();
        for (const [key, value] of Object.entries(attributes))
          attemptSpan.setAttr(key, value);
        if (details.failure)
          attemptSpan.error(`mutation ${outcome}: ${details.failure}`);
        count(`attempt.${outcome}`);
        if (details.failure) count(`failure.${details.failure}`);

        const hadLoggedFailure = loggedKeys.has(`${mutation.uuid}|failed`);
        if (
          LOGGED_OUTCOMES.has(outcome) &&
          firstOccurrence(
            `${mutation.uuid}|${outcome}|${details.failure ?? ''}|${errorCode ?? ''}`
          )
        ) {
          loggedKeys.add(`${mutation.uuid}|failed`);
          attemptSpan.run(() =>
            Telemetry.warn(
              `graphql.mutation_queue.${outcome.replaceAll('-', '_')}`,
              {
                ...attributes,
                ...environmentAttributes(),
                'mutation_queue.recovered': tracked.recovered,
              }
            )
          );
        } else if (outcome === 'committed' && hadLoggedFailure) {
          attemptSpan.run(() =>
            Telemetry.info('graphql.mutation_queue.committed_after_failure', {
              ...attributes,
              ...environmentAttributes(),
            })
          );
        }
        attemptSpan.end();
        if (TERMINAL_OUTCOMES.has(outcome)) forgetItem(mutation.uuid);
      },
    };
  }

  return {
    loaded(inspect) {
      inspectQueue = inspect;
      fireAndForget(
        Telemetry.span('graphql.mutation_queue.loaded', async (span) => {
          const sampled = await sampleQueue();
          span.setAttr('mutation_queue.depth_available', sampled !== undefined);
          if (sampled === undefined) return;
          for (const [key, value] of Object.entries(sampled))
            span.setAttr(key, value);
          if ((sampled['mutation_queue.depth'] ?? 0) > 0)
            Telemetry.info('graphql.mutation_queue.loaded', {
              ...environmentAttributes(),
              ...sampled,
            });
        }),
        'graphql-cache-mutation-queue'
      );
    },
    enqueue({ uuid, operationName }) {
      const startedAt = now();
      const span = Telemetry.span('graphql.mutation_queue.enqueue');
      span.setAttr(
        'graphql.operation.name',
        operationNameAttribute(operationName)
      );
      if (uuid) span.setAttr('mutation_queue.item_id', uuid);
      return {
        persisted({ transactionId, replaced, claimed, linkPatchesDegraded }) {
          // A replacement inherits a durable time this tab learns at claim.
          if (uuid && !items.has(uuid))
            items.set(uuid, {
              firstSeenAt: startedAt,
              recovered: false,
              enqueuedAtMs: replaced ? undefined : startedAt,
            });
          span.setAttr('mutation_queue.transaction_id', transactionId);
          span.setAttr('mutation_queue.replaced_pending', replaced);
          span.setAttr('mutation_queue.claimed_on_enqueue', claimed);
          span.setAttr(
            'mutation_queue.link_patches_degraded',
            linkPatchesDegraded
          );
          if (linkPatchesDegraded) count('enqueue.link-patches-degraded');
          span.setAttr('mutation_queue.enqueue_ms', now() - startedAt);
          for (const [key, value] of Object.entries(queueAttributes()))
            span.setAttr(key, value);
          count('enqueue.persisted');
          span.end();
        },
        failed(reason) {
          span.setAttr('mutation_queue.enqueue_failure', reason);
          span.setAttr('mutation_queue.enqueue_ms', now() - startedAt);
          span.error(`mutation enqueue failed: ${reason}`);
          count(`enqueue.failed.${reason}`);
          if (firstOccurrence(`enqueue|${reason}`))
            span.run(() =>
              Telemetry.warn('graphql.mutation_queue.enqueue_failed', {
                ...environmentAttributes(),
                'graphql.operation.name': operationNameAttribute(operationName),
                'mutation_queue.enqueue_failure': reason,
              })
            );
          span.end();
        },
      };
    },
    attempt,
    skipped(reason) {
      count(`skip.${reason}`);
      if (firstOccurrence(`skip|${reason}`))
        Telemetry.warn('graphql.mutation_queue.skipped', {
          ...environmentAttributes(),
          ...queueAttributes(),
          'mutation_queue.skip_reason': reason,
        });
    },
    storageReset() {
      count('storage-reset');
      items.clear();
      loggedKeys.clear();
    },
  };
}
