import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarKeys } from '../keys';
import {
  useDeleteCalendarEventMutation,
  useRsvpCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '../mutations';
import type { CalendarOccurrencesData } from '../occurrences';

const rsvpCalendarEventMock = vi.hoisted(() => vi.fn());
const deleteCalendarEventMock = vi.hoisted(() => vi.fn());
const updateCalendarEventMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: {
    rsvpCalendarEvent: rsvpCalendarEventMock,
    deleteCalendarEvent: deleteCalendarEventMock,
    updateCalendarEvent: updateCalendarEventMock,
  },
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const viewportA = {
  start: '2026-08-01T04:00:00.000Z',
  end: '2026-09-01T04:00:00.000Z',
  startDate: '2026-08-01',
  endDate: '2026-09-01',
};
const viewportB = {
  start: '2026-08-03T04:00:00.000Z',
  end: '2026-08-10T04:00:00.000Z',
  startDate: '2026-08-03',
  endDate: '2026-08-10',
};

const standaloneItem = (): CalendarOccurrenceItem =>
  ({
    event: {
      id: 'event-1',
      title: 'Standalone',
      recurrenceLines: [],
      time: {
        kind: 'timed',
        startsAt: '2026-08-06T14:00:00Z',
        endsAt: '2026-08-06T15:00:00Z',
      },
      attendees: [
        {
          email: 'self@example.com',
          isSelf: true,
          responseStatus: 'needs_action',
        },
        {
          email: 'other@example.com',
          isSelf: false,
          responseStatus: 'declined',
        },
      ],
    },
    occurrence: {
      eventId: 'event-1',
      occurrenceKey: '2026-08-06T14:00:00Z',
      time: {
        kind: 'timed',
        startsAt: '2026-08-06T14:00:00Z',
        endsAt: '2026-08-06T15:00:00Z',
      },
    },
  }) as unknown as CalendarOccurrenceItem;

const recurringItem = (): CalendarOccurrenceItem =>
  ({
    event: {
      id: 'event-2',
      title: 'Recurring',
      recurrenceLines: ['RRULE:FREQ=DAILY'],
      time: {
        kind: 'timed',
        startsAt: '2026-08-04T09:00:00Z',
        endsAt: '2026-08-04T09:30:00Z',
      },
      attendees: [],
    },
    occurrence: {
      eventId: 'event-2',
      occurrenceKey: '2026-08-05T09:00:00Z',
      recurrenceId: '2026-08-05T09:00:00Z',
      time: {
        kind: 'timed',
        startsAt: '2026-08-05T09:00:00Z',
        endsAt: '2026-08-05T09:30:00Z',
      },
    },
  }) as unknown as CalendarOccurrenceItem;

const seedViewports = () => {
  const data = (): CalendarOccurrencesData => ({
    items: [standaloneItem(), recurringItem()],
    syncStatus: 'ready',
  });
  testQueryClient.setQueryData(
    calendarKeys.occurrences('user', viewportA).queryKey,
    data()
  );
  testQueryClient.setQueryData(
    calendarKeys.occurrences('user', viewportB).queryKey,
    data()
  );
};

const viewportData = (range: typeof viewportA) =>
  testQueryClient.getQueryData<CalendarOccurrencesData>(
    calendarKeys.occurrences('user', range).queryKey
  );

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

const failure = () =>
  err([{ code: 'HTTP_ERROR' as const, message: 'provider says no' }]);

function deferredResult() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seedViewports();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('useRsvpCalendarEventMutation', () => {
  it('optimistically updates the self attendee across every cached viewport', async () => {
    rsvpCalendarEventMock.mockResolvedValue(ok({ id: 'event-1' }));
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    await rsvp.mutateAsync({ eventId: 'event-1', response: 'accepted' });

    for (const range of [viewportA, viewportB]) {
      const items = viewportData(range)?.items ?? [];
      const event = items.find((item) => item.event.id === 'event-1')?.event;
      expect(
        event?.attendees.find((attendee) => attendee.isSelf)?.responseStatus
      ).toBe('accepted');
      expect(
        event?.attendees.find((attendee) => !attendee.isSelf)?.responseStatus
      ).toBe('declined');
    }
    expect(rsvpCalendarEventMock).toHaveBeenCalledWith('event-1', {
      response: 'accepted',
    });
  });

  // Three occurrences of one series, so a scoped answer has something to
  // leave alone.
  const seriesOccurrence = (key: string): CalendarOccurrenceItem =>
    ({
      event: {
        id: 'event-3',
        title: 'Standup',
        recurrenceLines: ['RRULE:FREQ=DAILY'],
        time: { kind: 'timed', startsAt: key, endsAt: key },
        attendees: [
          {
            email: 'self@example.com',
            isSelf: true,
            responseStatus: 'accepted',
          },
        ],
      },
      occurrence: {
        eventId: 'event-3',
        occurrenceKey: key,
        recurrenceId: key,
        time: { kind: 'timed', startsAt: key, endsAt: key },
      },
    }) as unknown as CalendarOccurrenceItem;
  const seriesKeys = [
    '2026-08-04T09:00:00Z',
    '2026-08-05T09:00:00Z',
    '2026-08-06T09:00:00Z',
  ];
  const seedSeries = () =>
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: seriesKeys.map(seriesOccurrence), syncStatus: 'ready' }
    );
  const responseAt = (key: string) =>
    viewportData(viewportA)
      ?.items.find((item) => item.occurrence.occurrenceKey === key)
      ?.event.attendees.find((attendee) => attendee.isSelf)?.responseStatus;

  it('scopes the optimistic answer to the occurrences it covers', async () => {
    const keys = seriesKeys;
    seedSeries();
    rsvpCalendarEventMock.mockResolvedValue(ok({ id: 'event-3' }));
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    await rsvp.mutateAsync({
      eventId: 'event-3',
      response: 'declined',
      scope: 'this_event',
      recurrenceId: keys[1],
      occurrenceKey: keys[1],
    });

    expect(responseAt(keys[0])).toBe('accepted');
    expect(responseAt(keys[1])).toBe('declined');
    expect(responseAt(keys[2])).toBe('accepted');
    expect(rsvpCalendarEventMock).toHaveBeenCalledWith('event-3', {
      response: 'declined',
      scope: 'this_event',
      recurrenceId: keys[1],
    });

    await rsvp.mutateAsync({
      eventId: 'event-3',
      response: 'tentative',
      scope: 'all',
    });

    expect(responseAt(keys[0])).toBe('tentative');
    expect(responseAt(keys[1])).toBe('tentative');
    expect(responseAt(keys[2])).toBe('tentative');

    // An omitted scope with a recurrenceId is occurrence-scoped on the
    // server, so the optimistic patch must not widen it to the series.
    await rsvp.mutateAsync({
      eventId: 'event-3',
      response: 'declined',
      recurrenceId: keys[2],
      occurrenceKey: keys[2],
    });

    expect(responseAt(keys[0])).toBe('tentative');
    expect(responseAt(keys[1])).toBe('tentative');
    expect(responseAt(keys[2])).toBe('declined');
  });

  it('rolls back every viewport when the request fails', async () => {
    rsvpCalendarEventMock.mockResolvedValue(failure());
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    await expect(
      rsvp.mutateAsync({ eventId: 'event-1', response: 'declined' })
    ).rejects.toThrow();

    for (const range of [viewportA, viewportB]) {
      const items = viewportData(range)?.items ?? [];
      const event = items.find((item) => item.event.id === 'event-1')?.event;
      expect(
        event?.attendees.find((attendee) => attendee.isSelf)?.responseStatus
      ).toBe('needs_action');
    }
  });

  const selfStatus = () =>
    viewportData(viewportA)
      ?.items.find((item) => item.event.id === 'event-1')
      ?.event.attendees.find((attendee) => attendee.isSelf)?.responseStatus;

  it('keeps the newer optimistic response when an older overlapping request fails', async () => {
    const first = deferredResult();
    const second = deferredResult();
    rsvpCalendarEventMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    const firstMutation = rsvp
      .mutateAsync({ eventId: 'event-1', response: 'accepted' })
      .catch(() => {});
    await vi.waitFor(() => expect(selfStatus()).toBe('accepted'));

    const secondMutation = rsvp.mutateAsync({
      eventId: 'event-1',
      response: 'tentative',
    });
    await vi.waitFor(() => expect(selfStatus()).toBe('tentative'));

    first.resolve(failure());
    await firstMutation;
    expect(selfStatus()).toBe('tentative');

    second.resolve(ok({ id: 'event-1' }));
    await secondMutation;
    expect(selfStatus()).toBe('tentative');
  });

  it('keeps a newer identical response when the older request fails', async () => {
    const first = deferredResult();
    const second = deferredResult();
    rsvpCalendarEventMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    const firstMutation = rsvp
      .mutateAsync({ eventId: 'event-1', response: 'accepted' })
      .catch(() => {});
    await vi.waitFor(() => expect(selfStatus()).toBe('accepted'));

    // The second answer picks the same response, so equal cache values
    // cannot reveal which mutation wrote last — wait for its request to
    // confirm its optimistic write went through.
    const secondMutation = rsvp.mutateAsync({
      eventId: 'event-1',
      response: 'accepted',
    });
    await vi.waitFor(() =>
      expect(rsvpCalendarEventMock).toHaveBeenCalledTimes(2)
    );

    second.resolve(ok({ id: 'event-1' }));
    await secondMutation;
    expect(selfStatus()).toBe('accepted');

    first.resolve(failure());
    await firstMutation;
    expect(selfStatus()).toBe('accepted');
  });

  it('rolls a failed series answer back around a newer occurrence answer', async () => {
    seedSeries();
    const first = deferredResult();
    const second = deferredResult();
    rsvpCalendarEventMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    const firstMutation = rsvp
      .mutateAsync({ eventId: 'event-3', response: 'tentative', scope: 'all' })
      .catch(() => {});
    await vi.waitFor(() => expect(responseAt(seriesKeys[0])).toBe('tentative'));

    const secondMutation = rsvp.mutateAsync({
      eventId: 'event-3',
      response: 'declined',
      scope: 'this_event',
      recurrenceId: seriesKeys[1],
      occurrenceKey: seriesKeys[1],
    });
    await vi.waitFor(() => expect(responseAt(seriesKeys[1])).toBe('declined'));

    first.resolve(failure());
    await firstMutation;
    expect(responseAt(seriesKeys[0])).toBe('accepted');
    expect(responseAt(seriesKeys[1])).toBe('declined');
    expect(responseAt(seriesKeys[2])).toBe('accepted');

    second.resolve(ok({ id: 'event-3' }));
    await secondMutation;
    expect(responseAt(seriesKeys[1])).toBe('declined');
  });

  it('only refetches once the last overlapping request settles', async () => {
    const first = deferredResult();
    const second = deferredResult();
    rsvpCalendarEventMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');
    const rsvp = renderHook(() => useRsvpCalendarEventMutation());

    const firstMutation = rsvp.mutateAsync({
      eventId: 'event-1',
      response: 'accepted',
    });
    await vi.waitFor(() => expect(selfStatus()).toBe('accepted'));
    const secondMutation = rsvp.mutateAsync({
      eventId: 'event-1',
      response: 'declined',
    });
    await vi.waitFor(() => expect(selfStatus()).toBe('declined'));

    first.resolve(ok({ id: 'event-1' }));
    await firstMutation;
    expect(invalidateSpy).not.toHaveBeenCalled();

    second.resolve(ok({ id: 'event-1' }));
    await secondMutation;
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useDeleteCalendarEventMutation', () => {
  it('optimistically removes the event and keeps the removal on success', async () => {
    deleteCalendarEventMock.mockResolvedValue(ok({}));
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    await remove.mutateAsync({ eventId: 'event-1' });

    for (const range of [viewportA, viewportB]) {
      const items = viewportData(range)?.items ?? [];
      expect(items.map((item) => item.event.id)).toEqual(['event-2']);
    }
  });

  it('scopes optimistic removal to one occurrence or a suffix', async () => {
    deleteCalendarEventMock.mockResolvedValue(ok({}));
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    await remove.mutateAsync({
      eventId: 'event-2',
      scope: 'this_event',
      recurrenceId: '2026-08-05T09:00:00Z',
      occurrenceKey: '2026-08-05T09:00:00Z',
    });
    expect(deleteCalendarEventMock).toHaveBeenCalledWith('event-2', {
      scope: 'this_event',
      recurrenceId: '2026-08-05T09:00:00Z',
    });
    let items = viewportData(viewportA)?.items ?? [];
    expect(items.map((item) => item.occurrence.occurrenceKey)).toEqual([
      '2026-08-06T14:00:00Z',
    ]);

    seedViewports();
    await remove.mutateAsync({
      eventId: 'event-2',
      scope: 'this_and_following',
      recurrenceId: '2026-08-05T09:00:00Z',
      occurrenceKey: '2026-08-05T09:00:00Z',
    });
    items = viewportData(viewportA)?.items ?? [];
    expect(items.map((item) => item.event.id)).toEqual(['event-1']);
  });

  it('restores removed items when the request fails', async () => {
    deleteCalendarEventMock.mockResolvedValue(failure());
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    await expect(remove.mutateAsync({ eventId: 'event-1' })).rejects.toThrow();

    for (const range of [viewportA, viewportB]) {
      const items = viewportData(range)?.items ?? [];
      expect(items).toHaveLength(2);
    }
  });
});

describe('useUpdateCalendarEventMutation', () => {
  it('patches fields and only rewrites standalone occurrence times', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-1' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const time = {
      kind: 'timed',
      startsAt: '2026-08-06T16:00:00Z',
      endsAt: '2026-08-06T17:00:00Z',
    } as const;

    await update.mutateAsync({
      eventId: 'event-1',
      patch: { title: 'Renamed', time },
    });
    await update.mutateAsync({
      eventId: 'event-2',
      patch: { time },
    });

    const items = viewportData(viewportA)?.items ?? [];
    const standalone = items.find((item) => item.event.id === 'event-1');
    expect(standalone?.event.title).toBe('Renamed');
    expect(standalone?.occurrence.time).toEqual(time);

    const recurring = items.find((item) => item.event.id === 'event-2');
    expect(recurring?.event.time).toEqual(time);
    expect(recurring?.occurrence.time.kind === 'timed').toBe(true);
    expect(recurring?.occurrence.time).toMatchObject({
      startsAt: '2026-08-05T09:00:00Z',
    });
  });
});
