import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  DiscardTimerDocument,
  RunningTimerDocument,
  type RunningTimerQuery,
  StartTimerDocument,
  type StartTimerMutation,
  StopTimerDocument,
  type StopTimerMutation,
  type TimeTrackingFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import { authoritativeWriteResult, type TimeWriteResult } from './write-result';

/** The viewer's running timer with the task it times, or null when none runs. */
export type RunningTimer = NonNullable<
  TimeTrackingFieldsFragment['runningTimer']
>;

function timeTrackingOf(data: RunningTimerQuery): TimeTrackingFieldsFragment {
  return data.user.timeTracking;
}

/**
 * The viewer's running timer, read through the GraphQL cache and refreshed
 * from the server when it mounts. Timer writes replace it from their reply.
 * `serverNow` is the server's clock when a response arrived; a cached copy
 * says nothing about the current time.
 */
export function createRunningTimerQuery(
  enabled: Accessor<boolean>,
  client: Accessor<Client>
) {
  const query = createLiveQuery(
    RunningTimerDocument,
    () => (enabled() ? {} : undefined),
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      select: timeTrackingOf,
    })
  );
  return {
    timer: (): RunningTimer | undefined =>
      query.isPending ? undefined : (query.data?.runningTimer ?? undefined),
    serverNow: (): string | undefined =>
      query.isSuccess ? query.data?.serverNow : undefined,
    /** Whether the data came from the server just now, not from the cache. */
    fresh: () => query.isSuccess && !query.stale,
    pending: () => query.isPending,
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

/** The IANA zone of this device, whose calendar day a timer's entry takes. */
function deviceTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}

/** The GraphQL client a timer write goes through. */
export type TimerDependencies = { client: Client };

/**
 * Start timing a task. A timer running on another task stops and saves its
 * entry in the same step (`stoppedEntry`). Not queued offline: the server's
 * clock decides the start. `startedAt` restores an earlier start (Undo).
 */
export async function startTimer(
  args: { taskId: string; startedAt?: string },
  dependencies: TimerDependencies
): Promise<TimeWriteResult<StartTimerMutation['startTimer']>> {
  const { client } = dependencies;
  const result = await client
    .mutation(StartTimerDocument, {
      input: {
        id: uuidv7(),
        taskId: args.taskId,
        timeZone: deviceTimeZone(),
        startedAt: args.startedAt,
      },
    })
    .toPromise();
  return authoritativeWriteResult(result, (data) => data.startTimer);
}

/**
 * Stop the viewer's timer and save its entry. A timer past the limit is
 * refused (`over-limit`) until `endedAt` or `logAll` says what to log.
 * A timer another device stopped returns the entry it saved.
 */
export async function stopTimer(
  args: { timerId: string; endedAt?: string; logAll?: boolean },
  dependencies: TimerDependencies
): Promise<TimeWriteResult<StopTimerMutation['stopTimer']>> {
  const { client } = dependencies;
  const result = await client
    .mutation(StopTimerDocument, {
      input: {
        timerId: args.timerId,
        timeZone: deviceTimeZone(),
        endedAt: args.endedAt,
        logAll: args.logAll,
      },
    })
    .toPromise();
  return authoritativeWriteResult(result, (data) => data.stopTimer);
}

/** Discard the viewer's timer without saving anything. */
export async function discardTimer(
  args: { timerId: string },
  dependencies: TimerDependencies
): Promise<TimeWriteResult<null>> {
  const { client } = dependencies;
  const result = await client
    .mutation(DiscardTimerDocument, { timerId: args.timerId })
    .toPromise();
  return authoritativeWriteResult(result, () => null);
}
