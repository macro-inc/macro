import type { CalendarRangeCacheArgs } from '@graphql-cache/index';
import type {
  CalendarEventFieldsFragment,
  CalendarMutationPayloadFieldsFragment,
  CalendarOccurrenceItemFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { type Client, CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarMutationError,
  committedEvent,
  executeGraphqlCreate,
  executeGraphqlDelete,
  executeGraphqlRsvp,
  executeGraphqlUpdate,
  trackCalendarCreateSettlements,
} from '../mutations';
import { attendee, graphqlEvent, graphqlOccurrence } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const DISPOSITION = 'normalizedCacheMutationDisposition';
const OPTIMISTIC = 'normalizedCacheOptimistic';
const ENQUEUED = 'normalizedCacheOptimisticEnqueued';

type Disposition = 'committed' | 'queued' | 'failed';

interface OptimisticContext {
  uuid: string;
  optimisticResponse: Record<string, Record<string, unknown>>;
  identityBindings?: unknown[];
  uncertainCalendarEventKeys?: string[];
}

function fakeHost(
  event: CalendarEventFieldsFragment | undefined,
  occurrences: CalendarOccurrenceItemFieldsFragment[]
) {
  const records = new Map<string, unknown>([
    ...(event ? [[`GraphqlCalendarEvent:${event.id}`, event] as const] : []),
    ...occurrences.map(
      (occurrence) =>
        [`GraphqlCalendarOccurrence:${occurrence.id}`, occurrence] as const
    ),
  ]);
  return {
    calendarRange: vi.fn(async (args: CalendarRangeCacheArgs) => ({
      kind: 'range' as const,
      revision: '1' as never,
      occurrenceKeys: occurrences
        .filter(
          (occurrence) =>
            `GraphqlCalendarEvent:${occurrence.eventId}` === args.eventKey
        )
        .map((occurrence) => `GraphqlCalendarOccurrence:${occurrence.id}`),
      gaps: [],
      freshness: 'fresh' as const,
      uncertainEventKeys: [],
      optimistic: false,
      watermark: null,
    })),
    calendarCommit: vi.fn(async () => ({
      kind: 'committed' as const,
      revision: '2' as never,
      changed: [],
    })),
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: '1' as never,
      records: keys.flatMap((recordKey) => {
        const record = records.get(recordKey);
        return record ? [{ recordKey, record }] : [];
      }),
    })),
  };
}

function fakeClient(
  disposition: Disposition,
  payload?: Partial<CalendarMutationPayloadFieldsFragment>,
  beforeResult?: () => void
) {
  const calls: Array<{
    variables: { input: Record<string, unknown> };
    optimistic: OptimisticContext;
  }> = [];
  const client = {
    mutation: (
      _document: unknown,
      variables: { input: Record<string, unknown> },
      context: Record<string, OptimisticContext>
    ) => {
      calls.push({ variables, optimistic: context[OPTIMISTIC]! });
      const enqueued = (context as Record<string, unknown>)[ENQUEUED];
      if (typeof enqueued === 'function') enqueued();
      beforeResult?.();
      const field = Object.keys(
        context[OPTIMISTIC]!.optimisticResponse
      )[0] as string;
      return {
        toPromise: async () => ({
          operation: { context },
          data:
            disposition === 'failed'
              ? undefined
              : {
                  [field]: {
                    __typename: 'GraphqlCalendarMutationPayload',
                    event: null,
                    occurrences: [],
                    deletedEventId: null,
                    ...payload,
                  },
                },
          error:
            disposition === 'failed'
              ? new CombinedError({
                  graphQLErrors: [
                    new GraphQLError('this calendar is read-only', {
                      extensions: { code: 'read_only', retryable: false },
                    }),
                  ],
                })
              : undefined,
          extensions: {
            [DISPOSITION]:
              disposition === 'queued'
                ? { kind: 'queued', transactionId: 'tx-1' }
                : disposition === 'failed'
                  ? { kind: 'permanently-failed' }
                  : { kind: 'committed' },
          },
        }),
      };
    },
    query: () => ({
      toPromise: async () => ({
        data: {
          user: {
            id: 'user-1',
            calendars: [
              {
                __typename: 'GraphqlCalendar',
                id: 'calendar-1',
                linkId: 'link-1',
                emailAddress: 'me@example.com',
                name: 'Primary',
                color: null,
                isPrimary: true,
                isWritable: true,
                isSubscription: false,
                syncError: null,
                defaultReminders: [],
              },
            ],
          },
        },
      }),
    }),
  };
  return { calls, client: client as unknown as Client };
}

const response = (call: { optimistic: OptimisticContext }) =>
  Object.values(call.optimistic.optimisticResponse)[0] as {
    event?: Partial<CalendarEventFieldsFragment>;
    occurrences: Array<Partial<CalendarOccurrenceItemFieldsFragment>>;
  };

const instance = (day: number, overrides = {}) =>
  graphqlOccurrence({
    id: `event-1:2026-10-0${day}T09:00:00+00:00`,
    occurrenceKey: `2026-10-0${day}T09:00:00+00:00`,
    ...overrides,
  });

describe('executeGraphqlRsvp', () => {
  it('answers the series and every instance carrying its own attendee list', async () => {
    const declined = instance(6, {
      overrideAttendees: [attendee('me@example.com', 'DECLINED')],
    });
    const host = fakeHost(graphqlEvent(), [instance(5), declined]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlRsvp(
      host,
      { eventId: 'event-1', response: 'accepted' },
      client
    );

    const [call] = calls;
    expect(call?.variables.input).toEqual({
      eventId: 'event-1',
      response: 'ACCEPTED',
    });
    const optimistic = response(call!);
    expect(optimistic.event?.attendees?.[0]?.responseStatus).toBe('ACCEPTED');
    expect(optimistic.occurrences).toEqual([
      {
        __typename: 'GraphqlCalendarOccurrence',
        id: declined.id,
        overrideAttendees: [attendee('me@example.com', 'ACCEPTED')],
      },
    ]);
  });

  it('records an instance answer on that instance alone and coalesces repeats', async () => {
    const host = fakeHost(graphqlEvent(), [instance(5), instance(6)]);
    const { calls, client } = fakeClient('queued');
    const args = {
      eventId: 'event-1',
      response: 'declined' as const,
      scope: 'this_event' as const,
      recurrenceId: 'r6',
      occurrenceKey: '2026-10-06T09:00:00+00:00',
    };

    const outcome = await executeGraphqlRsvp(host, args, client);
    await executeGraphqlRsvp(host, { ...args, response: 'accepted' }, client);

    expect(outcome).toEqual({ kind: 'queued' });
    const optimistic = response(calls[0]!);
    expect(optimistic.event).toBeUndefined();
    expect(optimistic.occurrences).toEqual([
      expect.objectContaining({
        id: 'event-1:2026-10-06T09:00:00+00:00',
        overrideAttendees: [attendee('me@example.com', 'DECLINED')],
      }),
    ]);
    expect(calls[0]?.variables.input).toMatchObject({
      scope: 'THIS_EVENT',
      recurrenceId: 'r6',
    });
    expect(calls[1]?.optimistic.uuid).toBe(calls[0]?.optimistic.uuid);
    expect(host.calendarCommit).not.toHaveBeenCalled();
  });
});

describe('executeGraphqlUpdate', () => {
  it('moves a standalone event and its occurrence', async () => {
    const event = graphqlEvent({ recurrenceLines: [] });
    const host = fakeHost(event, [instance(6)]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlUpdate(
      host,
      {
        eventId: 'event-1',
        patch: {
          title: 'Moved',
          time: {
            kind: 'timed',
            startsAt: '2026-10-07T10:00:00Z',
            endsAt: '2026-10-07T10:30:00Z',
          },
        },
      },
      client
    );

    const [call] = calls;
    const optimistic = response(call!);
    expect(optimistic.event?.title).toBe('Moved');
    expect(optimistic.event?.sources?.[0]?.title).toBe('Moved');
    expect(optimistic.event?.sources?.[1]?.title).toBe('Team standup');
    expect(optimistic.occurrences).toEqual([
      {
        __typename: 'GraphqlCalendarOccurrence',
        id: 'event-1:2026-10-06T09:00:00+00:00',
        time: {
          __typename: 'GraphqlTimedEventTime',
          startsAt: '2026-10-07T10:00:00+00:00',
          endsAt: '2026-10-07T10:30:00+00:00',
          timeZone: null,
        },
      },
    ]);
    expect(call?.variables.input).toMatchObject({
      eventId: 'event-1',
      title: 'Moved',
      time: {
        timed: {
          startsAt: '2026-10-07T10:00:00Z',
          endsAt: '2026-10-07T10:30:00Z',
        },
      },
    });
    expect(call?.optimistic.uncertainCalendarEventKeys).toBeUndefined();
  });

  it('leaves recurring instances in place and marks the series uncertain', async () => {
    const host = fakeHost(graphqlEvent(), [instance(6)]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlUpdate(
      host,
      {
        eventId: 'event-1',
        patch: {
          time: {
            kind: 'timed',
            startsAt: '2026-10-07T10:00:00Z',
            endsAt: '2026-10-07T10:30:00Z',
          },
        },
      },
      client
    );

    expect(response(calls[0]!).occurrences).toEqual([]);
    expect(calls[0]?.optimistic.uncertainCalendarEventKeys).toEqual([
      'GraphqlCalendarEvent:event-1',
    ]);
  });

  it('patches only the addressed copy of a multi-calendar event', async () => {
    const host = fakeHost(graphqlEvent(), []);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlUpdate(
      host,
      {
        eventId: 'event-1',
        calendarId: 'calendar-2',
        patch: { title: 'Mine' },
      },
      client
    );

    const optimistic = response(calls[0]!);
    expect(optimistic.event?.title).toBe('Standup');
    expect(optimistic.event?.sources?.[1]?.title).toBe('Mine');
  });

  it('writes a one-occurrence patch as that occurrence’s exception', async () => {
    const host = fakeHost(graphqlEvent(), [instance(5), instance(6)]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlUpdate(
      host,
      {
        eventId: 'event-1',
        scope: 'this_event',
        recurrenceId: 'r6',
        occurrenceKey: '2026-10-06T09:00:00+00:00',
        patch: { title: 'Just today', location: '' },
      },
      client
    );

    const optimistic = response(calls[0]!);
    expect(optimistic.event).toBeUndefined();
    expect(optimistic.occurrences).toEqual([
      {
        __typename: 'GraphqlCalendarOccurrence',
        id: 'event-1:2026-10-06T09:00:00+00:00',
        overrideTitle: 'Just today',
        overrideLocation: '',
      },
    ]);
  });

  it('replaces the event’s occurrences with the committed answer', async () => {
    const host = fakeHost(graphqlEvent(), [instance(6)]);
    const moved = instance(7);
    const removed = { ...instance(6), isCancelled: true };
    const { client } = fakeClient('committed', {
      event: graphqlEvent({ title: 'Moved' }),
      occurrences: [moved, removed],
    });

    const outcome = await executeGraphqlUpdate(
      host,
      { eventId: 'event-1', patch: { title: 'Moved' } },
      client
    );

    expect(host.calendarCommit).toHaveBeenCalledWith({
      replacedEvents: [
        {
          eventKey: 'GraphqlCalendarEvent:event-1',
          occurrenceKeys: [`GraphqlCalendarOccurrence:${moved.id}`],
        },
      ],
    });
    expect(committedEvent(outcome)?.title).toBe('Moved');
  });

  it('surfaces a rejection with its code', async () => {
    const host = fakeHost(graphqlEvent(), []);
    const { client } = fakeClient('failed');

    const failure = executeGraphqlUpdate(
      host,
      { eventId: 'event-1', patch: { title: 'Nope' } },
      client
    );

    await expect(failure).rejects.toBeInstanceOf(CalendarMutationError);
    await expect(failure).rejects.toMatchObject({
      message: 'this calendar is read-only',
      code: 'read_only',
      retryable: false,
    });
    expect(host.calendarCommit).not.toHaveBeenCalled();
  });
});

describe('executeGraphqlDelete', () => {
  it('cancels the occurrence and everything after it', async () => {
    const host = fakeHost(graphqlEvent(), [
      instance(5),
      instance(6),
      instance(7),
    ]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlDelete(
      host,
      {
        eventId: 'event-1',
        scope: 'this_and_following',
        recurrenceId: 'r6',
        occurrenceKey: '2026-10-06T09:00:00+00:00',
      },
      client
    );

    expect(response(calls[0]!).occurrences.map((o) => o.id)).toEqual([
      'event-1:2026-10-06T09:00:00+00:00',
      'event-1:2026-10-07T09:00:00+00:00',
    ]);
    expect(calls[0]?.variables.input).toMatchObject({
      scope: 'THIS_AND_FOLLOWING',
    });
  });

  it('drops one copy of a multi-calendar event and re-projects the next', async () => {
    const host = fakeHost(graphqlEvent(), [instance(6)]);
    const { calls, client } = fakeClient('committed');

    await executeGraphqlDelete(host, { eventId: 'event-1' }, client);

    const optimistic = response(calls[0]!);
    expect(optimistic.occurrences).toEqual([]);
    expect(optimistic.event?.title).toBe('Team standup');
    expect(optimistic.event?.calendarId).toBe('calendar-2');
    expect(optimistic.event?.sources).toHaveLength(1);
  });

  it('cancels every cached occurrence of a single-copy event', async () => {
    const event = graphqlEvent();
    const host = fakeHost({ ...event, sources: event.sources.slice(0, 1) }, [
      instance(5),
      instance(6),
    ]);
    const { calls, client } = fakeClient('committed', {
      deletedEventId: 'event-1',
    });

    await executeGraphqlDelete(host, { eventId: 'event-1' }, client);

    expect(
      response(calls[0]!).occurrences.every((o) => o.isCancelled === true)
    ).toBe(true);
    expect(response(calls[0]!).occurrences).toHaveLength(2);
    expect(host.calendarCommit).toHaveBeenCalledWith({
      deletedEventKeys: ['GraphqlCalendarEvent:event-1'],
    });
  });
});

describe('executeGraphqlCreate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the event at once under its idempotency key', async () => {
    const { calls, client } = fakeClient('committed', {
      event: graphqlEvent({ id: 'server-1', title: 'Lunch' }),
    });

    const { event } = await executeGraphqlCreate(
      {
        title: 'Lunch',
        time: {
          kind: 'timed',
          startsAt: '2026-10-07T12:00:00Z',
          endsAt: '2026-10-07T13:00:00Z',
        },
        attendees: [{ email: 'guest@example.com' }],
      },
      client
    );

    const [call] = calls;
    const clientId = call?.optimistic.uuid;
    expect(call?.variables.input.idempotencyKey).toBe(clientId);
    const optimistic = response(call!);
    expect(optimistic.event).toMatchObject({
      id: clientId,
      linkId: 'link-1',
      calendarId: 'calendar-1',
      title: 'Lunch',
      status: 'CONFIRMED',
    });
    expect(optimistic.occurrences).toEqual([
      expect.objectContaining({
        id: `${clientId}:2026-10-07T12:00:00+00:00`,
        eventId: clientId,
        linkId: 'link-1',
        isCancelled: false,
      }),
    ]);
    expect(call?.optimistic.identityBindings).toEqual([
      {
        localKey: `GraphqlCalendarEvent:${clientId}`,
        responsePath: ['createCalendarEvent', 'event'],
        referenceFields: ['GraphqlCalendarOccurrence.eventId'],
      },
    ]);
    expect(event.id).toBe('server-1');
  });

  it('marks a recurring create uncertain', async () => {
    const { calls, client } = fakeClient('committed', {
      event: graphqlEvent({ id: 'server-1' }),
    });

    await executeGraphqlCreate(
      {
        title: 'Weekly',
        recurrenceLines: ['RRULE:FREQ=WEEKLY'],
        time: {
          kind: 'allDay',
          startDate: '2026-10-07',
          endDate: '2026-10-08',
        },
      },
      client
    );

    const clientId = calls[0]?.optimistic.uuid;
    expect(calls[0]?.optimistic.uncertainCalendarEventKeys).toEqual([
      `GraphqlCalendarEvent:${clientId}`,
    ]);
  });

  it('holds writes to a queued event until its create settles', async () => {
    let settle: ((settlement: { mutationUuid?: string }) => void) | undefined;
    const untrack = trackCalendarCreateSettlements({
      onMutationSettled: (callback) => {
        settle = callback as typeof settle;
        return () => {};
      },
    });
    const { client } = fakeClient('queued');
    const { outcome, event } = await executeGraphqlCreate(
      {
        title: 'Offline',
        time: {
          kind: 'allDay',
          startDate: '2026-10-07',
          endDate: '2026-10-08',
        },
      },
      client
    );
    const host = fakeHost(undefined, []);

    expect(outcome).toEqual({ kind: 'queued' });
    await expect(
      executeGraphqlUpdate(
        host,
        { eventId: event.id, patch: { title: 'Renamed' } },
        fakeClient('committed').client
      )
    ).rejects.toMatchObject({ code: 'not_found' });

    settle?.({ mutationUuid: event.id });
    await expect(
      executeGraphqlUpdate(
        host,
        { eventId: event.id, patch: { title: 'Renamed' } },
        fakeClient('committed').client
      )
    ).resolves.toMatchObject({ kind: 'committed' });
    untrack();
  });

  it('releases a queued create the queue settled before the call returned', async () => {
    let settle: ((settlement: { mutationUuid?: string }) => void) | undefined;
    const untrack = trackCalendarCreateSettlements({
      onMutationSettled: (callback) => {
        settle = callback as typeof settle;
        return () => {};
      },
    });
    let clientId: string | undefined;
    const { calls, client } = fakeClient('queued', undefined, () => {
      clientId = calls[0]?.optimistic.uuid;
      settle?.({ mutationUuid: clientId });
    });

    const { event } = await executeGraphqlCreate(
      {
        title: 'Settled early',
        time: {
          kind: 'allDay',
          startDate: '2026-10-07',
          endDate: '2026-10-08',
        },
      },
      client
    );

    expect(event.id).toBe(clientId);
    await expect(
      executeGraphqlUpdate(
        fakeHost(undefined, []),
        { eventId: event.id, patch: { title: 'Renamed' } },
        fakeClient('committed').client
      )
    ).resolves.toMatchObject({ kind: 'committed' });
    untrack();
  });

  it('forgets a create the server rejected', async () => {
    const { calls, client } = fakeClient('failed');

    await expect(
      executeGraphqlCreate(
        {
          title: 'Rejected',
          time: {
            kind: 'allDay',
            startDate: '2026-10-07',
            endDate: '2026-10-08',
          },
        },
        client
      )
    ).rejects.toBeInstanceOf(CalendarMutationError);

    const clientId = calls[0]?.optimistic.uuid ?? '';
    await expect(
      executeGraphqlUpdate(
        fakeHost(undefined, []),
        { eventId: clientId, patch: { title: 'Renamed' } },
        fakeClient('committed').client
      )
    ).resolves.toMatchObject({ kind: 'committed' });
  });
});
