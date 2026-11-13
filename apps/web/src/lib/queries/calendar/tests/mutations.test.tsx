import {
  beginCacheWriteSession,
  endCacheWriteSession,
} from '@graphql-cache/session-writes';
import { previewKeys } from '@queries/preview/keys';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createMemo, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calendarUpdateReadRevision,
  isCalendarEventUpdating,
  reconcileCalendarUpdateRead,
} from '../event-updates';
import {
  type CalendarSyncController,
  setActiveCalendarSyncController,
} from '../graphql/sync-controller';
import { invalidateInvitationScheduling } from '../invitations';
import { calendarKeys } from '../keys';
import {
  isGuestInviteRefused,
  useDeleteCalendarEventMutation,
  useInviteCalendarEventGuestsMutation,
  useRsvpCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '../mutations';
import type { CalendarOccurrencesData } from '../occurrences';
import {
  projectCalendarOccurrenceTime,
  shiftCalendarEventTime,
} from '../optimistic-time';

const rsvpCalendarEventMock = vi.hoisted(() => vi.fn());
const deleteCalendarEventMock = vi.hoisted(() => vi.fn());
const updateCalendarEventMock = vi.hoisted(() => vi.fn());
const inviteCalendarEventGuestsMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: {
    rsvpCalendarEvent: rsvpCalendarEventMock,
    deleteCalendarEvent: deleteCalendarEventMock,
    updateCalendarEvent: updateCalendarEventMock,
    inviteCalendarEventGuests: inviteCalendarEventGuestsMock,
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

const copy = (calendarId: string, title: string) => ({
  calendarId,
  title,
  eventType: 'default',
  visibility: 'default',
  transparency: 'opaque',
  isReadOnly: false,
  reminders: { useDefault: true, overrides: [] },
});

const sharedItem = (): CalendarOccurrenceItem =>
  ({
    event: {
      id: 'event-3',
      title: 'OOO',
      recurrenceLines: [],
      calendarId: 'primary',
      sources: [copy('primary', 'OOO'), copy('shared', '[me] OOO')],
      time: {
        kind: 'timed',
        startsAt: '2026-08-07T13:00:00Z',
        endsAt: '2026-08-07T17:00:00Z',
      },
      attendees: [],
    },
    occurrence: {
      eventId: 'event-3',
      occurrenceKey: '2026-08-07T13:00:00Z',
      time: {
        kind: 'timed',
        startsAt: '2026-08-07T13:00:00Z',
        endsAt: '2026-08-07T17:00:00Z',
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

/**
 * Keeps viewport A on screen, so a settled write refetches it, and holds that
 * refetch open until the test answers it.
 */
function watchViewportA() {
  let answer!: (data: CalendarOccurrencesData) => void;
  const refetch = vi.fn(
    () =>
      new Promise<CalendarOccurrencesData>((resolve) => {
        answer = resolve;
      })
  );
  const unsubscribe = new QueryObserver(testQueryClient, {
    queryKey: calendarKeys.occurrences('user', viewportA).queryKey,
    queryFn: refetch,
    staleTime: Number.POSITIVE_INFINITY,
  }).subscribe(() => {});
  return {
    refetch,
    answer: (data: CalendarOccurrencesData) => answer(data),
    unsubscribe,
  };
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
  setActiveCalendarSyncController(undefined);
  testQueryClient.clear();
});

it('keeps only the updating event locked through its post-save refresh', async () => {
  const watcher = watchViewportA();
  const response = deferredResult();
  updateCalendarEventMock.mockReturnValueOnce(response.promise);
  const { update, busy } = renderHook(() => ({
    update: useUpdateCalendarEventMutation(),
    busy: createMemo(() => isCalendarEventUpdating(testQueryClient, 'event-2')),
  }));
  expect(busy()).toBe(false);
  const save = update.mutateAsync({
    eventId: 'event-2',
    patch: { title: 'Updated' },
  });
  await vi.waitFor(() =>
    expect(updateCalendarEventMock).toHaveBeenCalledOnce()
  );
  expect(busy()).toBe(true);
  expect(isCalendarEventUpdating(testQueryClient, 'event-1')).toBe(false);
  response.resolve(ok({ id: 'event-2' }));
  await save;
  await vi.waitFor(() => expect(watcher.refetch).toHaveBeenCalledOnce());
  expect(busy()).toBe(true);
  watcher.answer({ items: [recurringItem()], syncStatus: 'ready' });
  await vi.waitFor(() => expect(busy()).toBe(false));
  watcher.unsubscribe();
});

it('waits for every refresh even when one range fails', async () => {
  const first = watchViewportA();
  const secondRead = Promise.withResolvers<CalendarOccurrencesData>();
  const second = new QueryObserver(testQueryClient, {
    queryKey: calendarKeys.occurrences('user', viewportB).queryKey,
    queryFn: () => secondRead.promise,
    staleTime: Number.POSITIVE_INFINITY,
  }).subscribe(() => {});
  updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
  const update = renderHook(() => useUpdateCalendarEventMutation());
  try {
    await update.mutateAsync({
      eventId: 'event-2',
      patch: { title: 'Updated' },
    });
    await vi.waitFor(() => expect(first.refetch).toHaveBeenCalledOnce());
    secondRead.reject(new Error('Refresh failed'));
    await vi.waitFor(() =>
      expect(
        testQueryClient.getQueryState(
          calendarKeys.occurrences('user', viewportB).queryKey
        )?.status
      ).toBe('error')
    );
    expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
    first.answer({ items: [recurringItem()], syncStatus: 'ready' });
    await vi.waitFor(() =>
      expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false)
    );
  } finally {
    first.unsubscribe();
    second();
  }
});

it('drains an uncached read and forces a new read before unlocking', async () => {
  const response = deferredResult();
  updateCalendarEventMock.mockReturnValueOnce(response.promise);
  const update = renderHook(() => useUpdateCalendarEventMutation());
  const save = update.mutateAsync({
    eventId: 'event-2',
    patch: { title: 'Updated' },
  });
  await vi.waitFor(() =>
    expect(updateCalendarEventMock).toHaveBeenCalledOnce()
  );
  const range = {
    start: '2026-11-01T00:00:00Z',
    end: '2026-12-01T00:00:00Z',
    startDate: '2026-11-01',
    endDate: '2026-12-01',
  };
  const firstRead = Promise.withResolvers<CalendarOccurrencesData>();
  const freshRead = Promise.withResolvers<CalendarOccurrencesData>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(firstRead.promise)
    .mockReturnValueOnce(freshRead.promise);
  const unsubscribe = new QueryObserver(testQueryClient, {
    queryKey: calendarKeys.occurrences('user', range).queryKey,
    queryFn: fetch,
  }).subscribe(() => {});
  try {
    response.resolve(ok({ id: 'event-2' }));
    await save;
    expect(fetch).toHaveBeenCalledOnce();
    expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
    const stale = { items: [], syncStatus: 'ready' as const };
    firstRead.resolve(stale);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
    freshRead.resolve(stale);
    await vi.waitFor(() =>
      expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false)
    );
    // Refresh completion is not semantic confirmation of the projected fields.
    expect(viewportData(viewportA)?.items[1].event.title).toBe('Updated');
  } finally {
    unsubscribe();
  }
});

it('retains its refresh lock across unmount and remount', async () => {
  const watcher = watchViewportA();
  updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
  const update = renderHook(() => useUpdateCalendarEventMutation());
  await update.mutateAsync({ eventId: 'event-2', patch: { title: 'Updated' } });
  await vi.waitFor(() => expect(watcher.refetch).toHaveBeenCalledOnce());
  watcher.unsubscribe();
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  const unsubscribe = new QueryObserver(testQueryClient, {
    queryKey: calendarKeys.occurrences('user', viewportA).queryKey,
    queryFn: watcher.refetch,
    staleTime: Number.POSITIVE_INFINITY,
  }).subscribe(() => {});
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  watcher.answer({ items: [recurringItem()], syncStatus: 'ready' });
  await vi.waitFor(() =>
    expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false)
  );
  unsubscribe();
});

it('includes a newly mounted range before ending the refresh lock', async () => {
  const first = watchViewportA();
  updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
  const update = renderHook(() => useUpdateCalendarEventMutation());
  await update.mutateAsync({ eventId: 'event-2', patch: { title: 'Updated' } });
  await vi.waitFor(() => expect(first.refetch).toHaveBeenCalledOnce());
  const initialRead = Promise.withResolvers<CalendarOccurrencesData>();
  const freshRead = Promise.withResolvers<CalendarOccurrencesData>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(initialRead.promise)
    .mockReturnValueOnce(freshRead.promise);
  const unsubscribe = new QueryObserver(testQueryClient, {
    queryKey: calendarKeys.occurrences('user', viewportB).queryKey,
    queryFn: fetch,
  }).subscribe(() => {});
  first.unsubscribe();
  const data = { items: [recurringItem()], syncStatus: 'ready' as const };
  first.answer(data);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  initialRead.resolve(data);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  freshRead.resolve(data);
  await vi.waitFor(() =>
    expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false)
  );
  unsubscribe();
});

it('keeps an in-flight event locked when all cached ranges are evicted', async () => {
  const response = deferredResult();
  updateCalendarEventMock.mockReturnValueOnce(response.promise);
  const update = renderHook(() => useUpdateCalendarEventMutation());
  const save = update.mutateAsync({
    eventId: 'event-2',
    patch: { title: 'Updated' },
  });
  const settled = Promise.allSettled([save]);
  await vi.waitFor(() =>
    expect(updateCalendarEventMock).toHaveBeenCalledOnce()
  );
  testQueryClient.removeQueries({ queryKey: calendarKeys.occurrences._def });
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  seedViewports();
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  response.resolve(failure());
  await settled;
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false);
});

it('unlocks and rolls back an event after its save fails', async () => {
  const response = deferredResult();
  updateCalendarEventMock.mockReturnValueOnce(response.promise);
  const update = renderHook(() => useUpdateCalendarEventMutation());
  const save = update.mutateAsync({
    eventId: 'event-2',
    patch: { title: 'Updated' },
  });
  const settled = Promise.allSettled([save]);
  await vi.waitFor(() =>
    expect(updateCalendarEventMock).toHaveBeenCalledOnce()
  );
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(true);
  response.resolve(failure());
  await settled;
  expect(isCalendarEventUpdating(testQueryClient, 'event-2')).toBe(false);
  expect(viewportData(viewportA)?.items[1].event.title).toBe('Recurring');
});

it('answers and deletes an imported point without rewriting its time', async () => {
  const point = standaloneItem();
  const instant = {
    kind: 'timed' as const,
    startsAt: '2026-08-06T14:00:00Z',
    endsAt: '2026-08-06T14:00:00Z',
    timeZone: null,
  };
  point.event.time = instant;
  point.occurrence.time = instant;
  for (const range of [viewportA, viewportB]) {
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', range).queryKey,
      {
        items: [point],
        syncStatus: 'ready',
      }
    );
  }
  rsvpCalendarEventMock.mockResolvedValue(ok({ id: 'event-1' }));
  deleteCalendarEventMock.mockResolvedValue(ok({}));
  const actions = renderHook(() => ({
    rsvp: useRsvpCalendarEventMutation(),
    remove: useDeleteCalendarEventMutation(),
  }));

  await actions.rsvp.mutateAsync({ eventId: 'event-1', response: 'accepted' });
  expect(rsvpCalendarEventMock).toHaveBeenCalledWith('event-1', {
    response: 'accepted',
  });
  for (const range of [viewportA, viewportB]) {
    expect(viewportData(range)?.items[0]?.occurrence.time).toEqual(instant);
  }
  await actions.remove.mutateAsync({ eventId: 'event-1' });
  expect(deleteCalendarEventMock).toHaveBeenCalledWith('event-1', {
    calendarId: undefined,
    scope: undefined,
    recurrenceId: undefined,
  });
  for (const range of [viewportA, viewportB]) {
    expect(viewportData(range)?.items).toEqual([]);
  }
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
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: calendarKeys.occurrences._def,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: previewKeys.item('event-1').queryKey,
    });
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

  it('finishes once the provider deletes the event, before the viewport refetch returns', async () => {
    deleteCalendarEventMock.mockResolvedValue(ok({}));
    const viewport = watchViewportA();
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    const deleted = remove.mutateAsync({ eventId: 'event-1' });
    await vi.waitFor(() => expect(viewport.refetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(remove.isSuccess).toBe(true));
    await deleted;
    expect(viewportData(viewportA)?.items.map((item) => item.event.id)).toEqual(
      ['event-2']
    );

    viewport.answer({ items: [recurringItem()], syncStatus: 'ready' });
    await vi.waitFor(() => expect(testQueryClient.isFetching()).toBe(0));
    expect(viewportData(viewportA)?.items.map((item) => item.event.id)).toEqual(
      ['event-2']
    );
    viewport.unsubscribe();
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

  it('drops only the addressed copy of a multi-calendar event', async () => {
    deleteCalendarEventMock.mockResolvedValue(ok({}));
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: [sharedItem()], syncStatus: 'ready' }
    );
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    await remove.mutateAsync({ eventId: 'event-3', calendarId: 'primary' });
    expect(deleteCalendarEventMock).toHaveBeenCalledWith('event-3', {
      calendarId: 'primary',
      scope: undefined,
      recurrenceId: undefined,
    });
    let items = viewportData(viewportA)?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].event.sources?.map((source) => source.calendarId)).toEqual([
      'shared',
    ]);
    expect(items[0].event.calendarId).toBe('shared');
    expect(items[0].event.title).toBe('[me] OOO');

    await remove.mutateAsync({ eventId: 'event-3', calendarId: 'shared' });
    items = viewportData(viewportA)?.items ?? [];
    expect(items).toHaveLength(0);
  });

  it('drops the canonical copy when no calendar is named', async () => {
    deleteCalendarEventMock.mockResolvedValue(ok({}));
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: [sharedItem()], syncStatus: 'ready' }
    );
    const remove = renderHook(() => useDeleteCalendarEventMutation());

    await remove.mutateAsync({ eventId: 'event-3' });
    const items = viewportData(viewportA)?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].event.sources?.map((source) => source.calendarId)).toEqual([
      'shared',
    ]);
    expect(items[0].event.calendarId).toBe('shared');
  });
});

describe('useUpdateCalendarEventMutation', () => {
  it('retires queued writes without cached occurrences when the account changes', async () => {
    const firstResponse = deferredResult();
    updateCalendarEventMock.mockReturnValueOnce(firstResponse.promise);
    const installed = vi.fn();
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const first = update.mutateAsync({
      eventId: 'uncached-event',
      onOptimistic: installed,
      patch: { title: 'First' },
    });
    await vi.waitFor(() =>
      expect(updateCalendarEventMock).toHaveBeenCalledOnce()
    );
    const second = update.mutateAsync({
      eventId: 'uncached-event',
      onOptimistic: installed,
      patch: { title: 'Second' },
    });
    const results = Promise.allSettled([first, second]);
    try {
      await vi.waitFor(() => expect(installed).toHaveBeenCalledTimes(2));
      await endCacheWriteSession(async () => {});
      firstResponse.resolve(ok({ id: 'uncached-event' }));
      const settled = await results;
      expect(settled[1].status).toBe('rejected');
      expect(updateCalendarEventMock).toHaveBeenCalledOnce();
    } finally {
      firstResponse.resolve(ok({ id: 'uncached-event' }));
      await results;
      await beginCacheWriteSession(async () => {}).ready;
    }
  });

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    'reuses an anchored occurrence across viewports (saved %s, refreshed %s)',
    async (earlierSave, refreshed) => {
      const update = renderHook(() => useUpdateCalendarEventMutation());
      if (earlierSave) {
        updateCalendarEventMock.mockResolvedValueOnce(ok({ id: 'event-2' }));
        await update.mutateAsync({
          eventId: 'event-2',
          patch: {
            time: {
              kind: 'timed',
              startsAt: '2026-08-04T10:00:00Z',
              endsAt: '2026-08-04T10:30:00Z',
            },
          },
        });
      }
      const response = deferredResult();
      updateCalendarEventMock.mockReturnValueOnce(response.promise);
      const installed = vi.fn();
      const time = {
        kind: 'timed' as const,
        startsAt: '2026-08-04T11:00:00Z',
        endsAt: '2026-08-04T11:30:00Z',
      };
      const saved = update.mutateAsync({
        eventId: 'event-2',
        onOptimistic: installed,
        patch: { time },
      });
      const settled = Promise.allSettled([saved]);
      await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
      const range = {
        start: '2026-08-05T00:00:00Z',
        end: '2026-08-06T00:00:00Z',
        startDate: '2026-08-05',
        endDate: '2026-08-06',
      };
      const key = calendarKeys.occurrences('user', range).queryKey;
      const next = recurringItem();
      next.event.time = time;
      if (refreshed)
        next.occurrence = {
          ...next.occurrence,
          occurrenceKey: '2026-08-05T10:00:00Z',
          recurrenceId: '2026-08-05T10:00:00Z',
          time: {
            kind: 'timed',
            startsAt: '2026-08-05T10:00:00Z',
            endsAt: '2026-08-05T10:30:00Z',
          },
        };
      const data = { items: [next], syncStatus: 'ready' as const };
      testQueryClient.setQueryData(key, data);
      const projected = reconcileCalendarUpdateRead(
        testQueryClient,
        key,
        data,
        calendarUpdateReadRevision(testQueryClient),
        range
      );
      testQueryClient.setQueryData(key, projected);
      expect(projected.items).toHaveLength(1);
      expect(projected.items[0].occurrence.time).toMatchObject({
        startsAt: '2026-08-05T11:00:00.000Z',
      });
      response.resolve(failure());
      await settled;
      const restored =
        testQueryClient.getQueryData<CalendarOccurrencesData>(key)?.items[0]
          .occurrence.time;
      expect(restored?.kind === 'timed' && Date.parse(restored.startsAt)).toBe(
        Date.parse(
          earlierSave ? '2026-08-05T10:00:00Z' : '2026-08-05T09:00:00Z'
        )
      );
    }
  );

  it('retains a saved occurrence in a new range when the provider read is stale', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    await update.mutateAsync({
      eventId: 'event-2',
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T10:00:00Z',
          endsAt: '2026-08-04T10:30:00Z',
        },
      },
    });
    const range = {
      start: '2026-08-05T00:00:00Z',
      end: '2026-08-06T00:00:00Z',
      startDate: '2026-08-05',
      endDate: '2026-08-06',
    };
    const key = calendarKeys.occurrences('user', range).queryKey;
    const data = { items: [recurringItem()], syncStatus: 'ready' as const };
    testQueryClient.setQueryData(key, data);
    const projected = reconcileCalendarUpdateRead(
      testQueryClient,
      key,
      data,
      calendarUpdateReadRevision(testQueryClient),
      range
    );
    expect(projected.items[0].occurrence.time).toMatchObject({
      startsAt: '2026-08-05T10:00:00.000Z',
    });
  });

  it('uses the caller time basis when the first viewport opens during a save', async () => {
    testQueryClient.removeQueries({ queryKey: calendarKeys.occurrences._def });
    const original = recurringItem();
    const pending = deferredResult();
    updateCalendarEventMock.mockReturnValueOnce(pending.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const installed = vi.fn();
    const time = {
      kind: 'timed' as const,
      startsAt: '2026-08-04T11:00:00Z',
      endsAt: '2026-08-04T11:30:00Z',
    };
    const saving = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic: installed,
      timeBasis: {
        seriesTime: original.event.time,
        recurrenceLines: original.event.recurrenceLines,
        occurrence: original.occurrence,
      },
      patch: { time },
    });
    await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
    const key = calendarKeys.occurrences('user', viewportA).queryKey;
    const data = {
      items: [{ ...original, event: { ...original.event, time } }],
      syncStatus: 'ready' as const,
    };
    testQueryClient.setQueryData(key, data);
    const projected = reconcileCalendarUpdateRead(
      testQueryClient,
      key,
      data,
      calendarUpdateReadRevision(testQueryClient),
      viewportA
    );
    expect(projected.items[0].occurrence.time).toMatchObject({
      startsAt: '2026-08-05T11:00:00.000Z',
    });
    expect(updateCalendarEventMock.mock.calls[0][1]).not.toHaveProperty(
      'timeBasis'
    );
    pending.resolve(ok({ id: 'event-2' }));
    await saving;
  });

  it('rebases the caller anchor even when no viewport was cached', async () => {
    testQueryClient.removeQueries({ queryKey: calendarKeys.occurrences._def });
    const original = recurringItem();
    const timeBasis = {
      seriesTime: original.event.time,
      recurrenceLines: original.event.recurrenceLines,
      occurrence: original.occurrence,
    };
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    await update.mutateAsync({
      eventId: 'event-2',
      timeBasis,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T11:00:00Z',
          endsAt: '2026-08-04T11:30:00Z',
        },
      },
    });
    await update.mutateAsync({
      eventId: 'event-2',
      timeBasis,
      scope: 'this_event',
      occurrenceKey: original.occurrence.occurrenceKey,
      patch: { title: 'This occurrence' },
    });
    expect(updateCalendarEventMock.mock.calls[1][1].recurrenceId).toBe(
      '2026-08-05T11:00:00+00:00'
    );
  });

  it.each([true, false])(
    'removes stale range membership during a move that succeeds: %s',
    async (succeeded) => {
      const response = deferredResult();
      updateCalendarEventMock.mockReturnValueOnce(response.promise);
      const update = renderHook(() => useUpdateCalendarEventMutation());
      const installed = vi.fn();
      const saving = update.mutateAsync({
        eventId: 'event-2',
        onOptimistic: installed,
        patch: {
          time: {
            kind: 'timed',
            startsAt: '2026-08-05T09:00:00Z',
            endsAt: '2026-08-05T09:30:00Z',
          },
        },
      });
      await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
      const range = {
        start: '2026-08-05T00:00:00Z',
        end: '2026-08-06T00:00:00Z',
        startDate: '2026-08-05',
        endDate: '2026-08-06',
      };
      const key = calendarKeys.occurrences('user', range).queryKey;
      const data = { items: [recurringItem()], syncStatus: 'ready' as const };
      testQueryClient.setQueryData(key, data);
      const projected = reconcileCalendarUpdateRead(
        testQueryClient,
        key,
        data,
        calendarUpdateReadRevision(testQueryClient),
        range
      );
      expect(projected.items).toEqual([]);
      testQueryClient.setQueryData(key, projected);
      const finished = Promise.allSettled([saving]);
      response.resolve(succeeded ? ok({ id: 'event-2' }) : failure());
      await finished;
      if (succeeded) {
        expect(
          reconcileCalendarUpdateRead(
            testQueryClient,
            key,
            data,
            calendarUpdateReadRevision(testQueryClient),
            range
          ).items
        ).toEqual([]);
      } else {
        expect(
          testQueryClient.getQueryData<CalendarOccurrencesData>(key)?.items[0]
            .occurrence.time
        ).toEqual(recurringItem().occurrence.time);
      }
    }
  );

  it('filters a moved occurrence from an already cached range and restores it on failure', async () => {
    const pending = deferredResult();
    updateCalendarEventMock.mockReturnValueOnce(pending.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const installed = vi.fn();
    const saving = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic: installed,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-11T09:00:00Z',
          endsAt: '2026-08-11T09:30:00Z',
        },
      },
    });
    const settled = Promise.allSettled([saving]);
    await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
    expect(viewportData(viewportB)?.items.map((item) => item.event.id)).toEqual(
      ['event-1']
    );
    expect(viewportData(viewportA)?.items[1].occurrence.time).toMatchObject({
      startsAt: '2026-08-12T09:00:00.000Z',
    });
    pending.resolve(failure());
    await settled;
    expect(viewportData(viewportB)?.items[1]).toEqual(recurringItem());
  });

  it('does not guess a new occurrence address while a series time change is unresolved', async () => {
    const pending = deferredResult();
    updateCalendarEventMock.mockReturnValueOnce(pending.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const installed = vi.fn();
    const saving = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic: installed,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T11:00:00Z',
          endsAt: '2026-08-04T11:30:00Z',
        },
      },
    });
    await vi.waitFor(() => expect(installed).toHaveBeenCalledOnce());
    const unknown = recurringItem();
    unknown.occurrence = {
      ...unknown.occurrence,
      occurrenceKey: '2026-08-12T09:00:00Z',
      recurrenceId: '2026-08-12T09:00:00Z',
      time: {
        kind: 'timed',
        startsAt: '2026-08-12T09:00:00Z',
        endsAt: '2026-08-12T09:30:00Z',
      },
    };
    const range = {
      start: '2026-08-12T00:00:00Z',
      end: '2026-08-13T00:00:00Z',
      startDate: '2026-08-12',
      endDate: '2026-08-13',
    };
    const key = calendarKeys.occurrences('user', range).queryKey;
    const data = { items: [unknown], syncStatus: 'ready' as const };
    testQueryClient.setQueryData(key, data);
    expect(
      reconcileCalendarUpdateRead(
        testQueryClient,
        key,
        data,
        calendarUpdateReadRevision(testQueryClient),
        range
      )
    ).toEqual(data);
    await expect(
      update.mutateAsync({
        eventId: 'event-2',
        scope: 'this_event',
        occurrenceKey: unknown.occurrence.occurrenceKey,
        timeBasis: {
          seriesTime: unknown.event.time,
          recurrenceLines: unknown.event.recurrenceLines,
          occurrence: unknown.occurrence,
        },
        patch: { title: 'Unknown address' },
      })
    ).rejects.toThrow('Refresh this occurrence');
    expect(updateCalendarEventMock).toHaveBeenCalledOnce();
    pending.resolve(ok({ id: 'event-2' }));
    await saving;
  });

  it('updates only the addressed occurrence time without changing its cached series master', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const original = recurringItem();
    const other = {
      ...original,
      occurrence: {
        ...original.occurrence,
        occurrenceKey: '2026-08-06T09:00:00Z',
        recurrenceId: '2026-08-06T09:00:00Z',
      },
    };
    for (const range of [viewportA, viewportB]) {
      testQueryClient.setQueryData(
        calendarKeys.occurrences('user', range).queryKey,
        { items: [original, other], syncStatus: 'ready' }
      );
    }
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const time = {
      kind: 'timed' as const,
      startsAt: '2026-08-05T09:00:00Z',
      endsAt: '2026-08-05T10:00:00Z',
    };
    await update.mutateAsync({
      eventId: 'event-2',
      scope: 'this_event',
      recurrenceId: original.occurrence.occurrenceKey,
      occurrenceKey: original.occurrence.occurrenceKey,
      patch: { time },
    });
    for (const range of [viewportA, viewportB]) {
      const items = viewportData(range)?.items;
      expect(items?.[0].event.time).toEqual(original.event.time);
      expect(items?.[0].occurrence.time).toEqual(time);
      expect(items?.[1]).toEqual(other);
    }
  });

  it('notifies acceptance before starting the nonblocking occurrence refresh', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const started = Promise.withResolvers<void>();
    const refreshed = Promise.withResolvers<CalendarOccurrencesData>();
    const onWriteAccepted = vi.fn();
    const observed = Promise.withResolvers<void>();
    const read = vi.fn(() => {
      expect(onWriteAccepted).toHaveBeenCalledOnce();
      started.resolve();
      return refreshed.promise;
    });
    const unsubscribe = new QueryObserver(testQueryClient, {
      queryKey: calendarKeys.occurrences('user', viewportA).queryKey,
      queryFn: read,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe((query) => {
      if (query.data?.items[0]?.event.title === 'Refreshed') observed.resolve();
    });
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const saved = update.mutateAsync({
      eventId: 'event-2',
      onWriteAccepted,
      patch: { title: 'Updated' },
    });
    try {
      await started.promise;
      await saved;
      expect(update.isSuccess).toBe(true);
      expect(updateCalendarEventMock).toHaveBeenCalledWith('event-2', {
        title: 'Updated',
        calendarId: undefined,
        scope: undefined,
        recurrenceId: undefined,
      });
      const item = recurringItem();
      item.event.title = 'Refreshed';
      refreshed.resolve({ items: [item], syncStatus: 'ready' });
      await observed.promise;
      expect(viewportData(viewportA)?.items[0].event.title).toBe('Refreshed');
      expect(read).toHaveBeenCalledOnce();
    } finally {
      refreshed.resolve({ items: [], syncStatus: 'ready' });
      unsubscribe();
    }
  });
  it('patches fields and shifts recurring occurrences relative to their master', async () => {
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
      startsAt: '2026-08-07T16:00:00.000Z',
    });
  });

  it('finishes a save once the provider accepts it, then shows the refetched event', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-1' }));
    const viewport = watchViewportA();
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const titleOfEvent1 = () =>
      viewportData(viewportA)?.items.find((item) => item.event.id === 'event-1')
        ?.event.title;

    const saved = update.mutateAsync({
      eventId: 'event-1',
      patch: { title: 'Renamed' },
    });
    await vi.waitFor(() => expect(viewport.refetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(update.isSuccess).toBe(true));
    await saved;
    expect(titleOfEvent1()).toBe('Renamed');

    const refetched = standaloneItem();
    refetched.event.title = 'Renamed by the provider';
    viewport.answer({ items: [refetched], syncStatus: 'ready' });
    await vi.waitFor(() =>
      expect(titleOfEvent1()).toBe('Renamed by the provider')
    );
    viewport.unsubscribe();
  });

  it("keeps a newer edit on screen when an earlier save's refresh lands during it", async () => {
    const deltas: Array<() => void> = [];
    setActiveCalendarSyncController({
      answering: () => true,
      runDelta: () =>
        new Promise<void>((resolve) => {
          deltas.push(resolve);
        }),
    } as unknown as CalendarSyncController);
    let serverTitle = 'First';
    const read = vi.fn(async (): Promise<CalendarOccurrencesData> => {
      const revision = calendarUpdateReadRevision(testQueryClient);
      const item = standaloneItem();
      item.event.title = serverTitle;
      return reconcileCalendarUpdateRead(
        testQueryClient,
        calendarKeys.occurrences('user', viewportA).queryKey,
        { items: [item, recurringItem()], syncStatus: 'ready' },
        revision,
        viewportA
      );
    });
    const unsubscribe = new QueryObserver(testQueryClient, {
      queryKey: calendarKeys.occurrences('user', viewportA).queryKey,
      queryFn: read,
      staleTime: Number.POSITIVE_INFINITY,
    }).subscribe(() => {});
    const second = deferredResult();
    updateCalendarEventMock
      .mockResolvedValueOnce(ok({ id: 'event-1' }))
      .mockReturnValueOnce(second.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const titleOfEvent1 = () =>
      viewportData(viewportA)?.items.find((item) => item.event.id === 'event-1')
        ?.event.title;

    await update.mutateAsync({ eventId: 'event-1', patch: { title: 'First' } });
    const saving = update.mutateAsync({
      eventId: 'event-1',
      patch: { title: 'Second' },
    });
    await vi.waitFor(() => expect(titleOfEvent1()).toBe('Second'));

    deltas[0]();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(testQueryClient.isFetching()).toBe(0));
    expect(titleOfEvent1()).toBe('Second');

    serverTitle = 'Second';
    second.resolve(ok({ id: 'event-1' }));
    await saving;
    await vi.waitFor(() => expect(deltas).toHaveLength(2));
    deltas[1]();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(testQueryClient.isFetching()).toBe(0));
    expect(titleOfEvent1()).toBe('Second');
    unsubscribe();
  });

  it('projects queued series edits immediately and keeps newer edits after both writes fail', async () => {
    const first = deferredResult();
    const second = deferredResult();
    updateCalendarEventMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const onOptimistic = vi.fn();
    const firstSave = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T10:00:00Z',
          endsAt: '2026-08-04T10:30:00Z',
        },
      },
    });
    const firstResult = Promise.allSettled([firstSave]);
    await vi.waitFor(() => expect(onOptimistic).toHaveBeenCalledTimes(1));
    const secondSave = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T11:00:00Z',
          endsAt: '2026-08-04T12:00:00Z',
        },
      },
    });
    const secondResult = Promise.allSettled([secondSave]);
    await vi.waitFor(() => expect(onOptimistic).toHaveBeenCalledTimes(2));
    expect(updateCalendarEventMock).toHaveBeenCalledTimes(1);
    expect(viewportData(viewportA)?.items[1].occurrence.time).toMatchObject({
      startsAt: '2026-08-05T11:00:00.000Z',
      endsAt: '2026-08-05T12:00:00.000Z',
    });
    first.resolve(failure());
    expect((await firstResult)[0].status).toBe('rejected');
    await vi.waitFor(() =>
      expect(updateCalendarEventMock).toHaveBeenCalledTimes(2)
    );
    expect(viewportData(viewportA)?.items[1].occurrence.time).toMatchObject({
      startsAt: '2026-08-05T11:00:00.000Z',
    });
    second.resolve(failure());
    expect((await secondResult)[0].status).toBe('rejected');
    expect(viewportData(viewportA)?.items[1]).toEqual(recurringItem());
  });

  it.each([true, false])(
    'rebases a queued occurrence address when the series save succeeds: %s',
    async (succeeded) => {
      const first = deferredResult();
      updateCalendarEventMock
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(ok({ id: 'event-2' }));
      const update = renderHook(() => useUpdateCalendarEventMutation());
      const ready = vi.fn();
      const firstSave = update.mutateAsync({
        eventId: 'event-2',
        onOptimistic: ready,
        patch: {
          time: {
            kind: 'timed',
            startsAt: '2026-08-04T10:00:00Z',
            endsAt: '2026-08-04T10:30:00Z',
          },
        },
      });
      await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
      const secondSave = update.mutateAsync({
        eventId: 'event-2',
        scope: 'this_event',
        occurrenceKey: '2026-08-05T09:00:00Z',
        recurrenceId: '2026-08-05T10:00:00.000Z',
        onOptimistic: ready,
        patch: { title: 'Edited while saving' },
      });
      await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(2));
      const settled = Promise.allSettled([firstSave, secondSave]);
      first.resolve(succeeded ? ok({ id: 'event-2' }) : failure());
      await settled;
      expect(updateCalendarEventMock.mock.calls[1][1]).toMatchObject({
        recurrenceId: succeeded
          ? '2026-08-05T10:00:00+00:00'
          : '2026-08-05T09:00:00Z',
        title: 'Edited while saving',
      });
    }
  );

  it('retains projections through stale reads and reconciles a complete post-write read', async () => {
    const pending = deferredResult();
    updateCalendarEventMock.mockReturnValueOnce(pending.promise);
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const ready = vi.fn();
    const saved = update.mutateAsync({
      eventId: 'event-2',
      onOptimistic: ready,
      patch: {
        time: {
          kind: 'timed',
          startsAt: '2026-08-04T10:00:00Z',
          endsAt: '2026-08-04T10:30:00Z',
        },
      },
    });
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    const oldRead = calendarUpdateReadRevision(testQueryClient);
    const key = calendarKeys.occurrences('user', viewportA).queryKey;
    const stale = {
      items: [standaloneItem(), recurringItem()],
      syncStatus: 'ready' as const,
    };
    pending.resolve(ok({ id: 'event-2' }));
    await saved;
    expect(
      reconcileCalendarUpdateRead(testQueryClient, key, stale, oldRead).items[1]
        .occurrence.time
    ).toMatchObject({
      startsAt: '2026-08-05T10:00:00.000Z',
    });
    const freshRead = calendarUpdateReadRevision(testQueryClient);
    expect(
      reconcileCalendarUpdateRead(
        testQueryClient,
        key,
        { ...stale, partial: true },
        freshRead
      ).items[1].occurrence.time
    ).toMatchObject({
      startsAt: '2026-08-05T10:00:00.000Z',
    });
    expect(
      reconcileCalendarUpdateRead(testQueryClient, key, stale, freshRead)
        .items[1].occurrence.time
    ).toMatchObject({ startsAt: '2026-08-05T10:00:00.000Z' });
    const confirmed = recurringItem();
    confirmed.event.time = {
      kind: 'timed',
      startsAt: '2026-08-04T10:00:00Z',
      endsAt: '2026-08-04T10:30:00Z',
    };
    confirmed.occurrence.recurrenceId = '2026-08-05T10:00:00Z';
    confirmed.occurrence.time = {
      kind: 'timed',
      startsAt: '2026-08-05T10:00:00Z',
      endsAt: '2026-08-05T10:30:00Z',
    };
    const refreshed = { ...stale, items: [standaloneItem(), confirmed] };
    expect(
      reconcileCalendarUpdateRead(testQueryClient, key, refreshed, freshRead)
    ).toEqual(refreshed);
  });

  it('retains a saved title through a stale post-write read', async () => {
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    await update.mutateAsync({
      eventId: 'event-2',
      patch: { title: 'Latest title' },
    });
    const key = calendarKeys.occurrences('user', viewportA).queryKey;
    const revision = calendarUpdateReadRevision(testQueryClient);
    const stale = { items: [recurringItem()], syncStatus: 'ready' as const };
    expect(
      reconcileCalendarUpdateRead(testQueryClient, key, stale, revision)
        .items[0].event.title
    ).toBe('Latest title');
    const confirmed = recurringItem();
    confirmed.event.title = 'Latest title';
    const fresh = { ...stale, items: [confirmed] };
    expect(
      reconcileCalendarUpdateRead(testQueryClient, key, fresh, revision)
    ).toEqual(fresh);
  });

  it('does not mistake a different occurrence at the same time for the saved occurrence', async () => {
    const original = recurringItem();
    const other = recurringItem();
    other.occurrence = {
      ...other.occurrence,
      occurrenceKey: '2026-08-06T09:00:00Z',
      recurrenceId: '2026-08-06T09:00:00Z',
      time: {
        kind: 'timed',
        startsAt: '2026-08-06T09:00:00Z',
        endsAt: '2026-08-06T09:30:00Z',
      },
    };
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: [original, other], syncStatus: 'ready' }
    );
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-2' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    await update.mutateAsync({
      eventId: 'event-2',
      scope: 'this_event',
      occurrenceKey: original.occurrence.occurrenceKey,
      recurrenceId: original.occurrence.recurrenceId ?? undefined,
      patch: { time: other.occurrence.time },
    });
    const data = reconcileCalendarUpdateRead(
      testQueryClient,
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: [original, other], syncStatus: 'ready' },
      calendarUpdateReadRevision(testQueryClient)
    );
    expect(data.items[0].occurrence.time).toEqual(other.occurrence.time);
  });

  it('scopes an optimistic edit to the targeted occurrence, or widens to the series', async () => {
    const keys = [
      '2026-08-04T09:00:00Z',
      '2026-08-05T09:00:00Z',
      '2026-08-06T09:00:00Z',
    ];
    const occurrence = (key: string): CalendarOccurrenceItem =>
      ({
        event: {
          id: 'event-4',
          title: 'Standup',
          description: 'series notes',
          recurrenceLines: ['RRULE:FREQ=DAILY'],
          time: { kind: 'timed', startsAt: key, endsAt: key },
          attendees: [],
        },
        occurrence: {
          eventId: 'event-4',
          occurrenceKey: key,
          recurrenceId: key,
          time: { kind: 'timed', startsAt: key, endsAt: key },
        },
      }) as unknown as CalendarOccurrenceItem;
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: keys.map(occurrence), syncStatus: 'ready' }
    );
    updateCalendarEventMock.mockResolvedValue(ok({ id: 'event-4' }));
    const update = renderHook(() => useUpdateCalendarEventMutation());
    const descriptionAt = (key: string) =>
      viewportData(viewportA)?.items.find(
        (item) => item.occurrence.occurrenceKey === key
      )?.event.description;

    await update.mutateAsync({
      eventId: 'event-4',
      scope: 'this_event',
      recurrenceId: keys[1],
      occurrenceKey: keys[1],
      patch: { description: 'this day only' },
    });

    expect(descriptionAt(keys[0])).toBe('series notes');
    expect(descriptionAt(keys[1])).toBe('this day only');
    expect(descriptionAt(keys[2])).toBe('series notes');
    expect(updateCalendarEventMock).toHaveBeenCalledWith('event-4', {
      description: 'this day only',
      calendarId: undefined,
      scope: 'this_event',
      recurrenceId: keys[1],
    });

    await update.mutateAsync({
      eventId: 'event-4',
      scope: 'all',
      patch: { description: 'shared notes' },
    });

    expect(descriptionAt(keys[0])).toBe('shared notes');
    expect(descriptionAt(keys[1])).toBe('shared notes');
    expect(descriptionAt(keys[2])).toBe('shared notes');
  });
});

describe('useInviteCalendarEventGuestsMutation', () => {
  const attendeesOf = (eventId: string, range = viewportA) =>
    viewportData(range)?.items.find((item) => item.event.id === eventId)?.event
      .attendees;

  it('shows the new guests as unanswered on every viewport while the request is in flight', async () => {
    const pending = deferredResult();
    inviteCalendarEventGuestsMock.mockReturnValue(pending.promise);
    const invite = renderHook(() => useInviteCalendarEventGuestsMutation());

    const sent = invite.mutateAsync({
      eventId: 'event-1',
      guests: [
        { email: 'dana@example.com', optional: true },
        { email: 'Other@example.com' },
      ],
    });
    await vi.waitFor(() =>
      expect(inviteCalendarEventGuestsMock).toHaveBeenCalled()
    );

    for (const range of [viewportA, viewportB]) {
      expect(attendeesOf('event-1', range)).toEqual([
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
        {
          email: 'dana@example.com',
          responseStatus: 'needs_action',
          isOrganizer: false,
          isOptional: true,
          isSelf: false,
        },
      ]);
    }
    expect(inviteCalendarEventGuestsMock).toHaveBeenCalledWith('event-1', {
      calendarId: undefined,
      guests: [
        { email: 'dana@example.com', optional: true },
        { email: 'Other@example.com' },
      ],
      scope: undefined,
      recurrenceId: undefined,
    });
    pending.resolve(ok({ id: 'event-1' }));
    expect(await sent).toBe('sent');
  });

  it('adds guests to the targeted occurrence alone', async () => {
    const keys = ['2026-08-04T09:00:00Z', '2026-08-05T09:00:00Z'];
    const occurrence = (key: string): CalendarOccurrenceItem =>
      ({
        event: {
          id: 'event-4',
          recurrenceLines: ['RRULE:FREQ=DAILY'],
          time: { kind: 'timed', startsAt: key, endsAt: key },
          attendees: [],
        },
        occurrence: {
          eventId: 'event-4',
          occurrenceKey: key,
          recurrenceId: key,
          time: { kind: 'timed', startsAt: key, endsAt: key },
        },
      }) as unknown as CalendarOccurrenceItem;
    testQueryClient.setQueryData(
      calendarKeys.occurrences('user', viewportA).queryKey,
      { items: keys.map(occurrence), syncStatus: 'ready' }
    );
    inviteCalendarEventGuestsMock.mockResolvedValue(ok({ id: 'event-4' }));
    const invite = renderHook(() => useInviteCalendarEventGuestsMutation());
    const emailsAt = (key: string) =>
      viewportData(viewportA)
        ?.items.find((item) => item.occurrence.occurrenceKey === key)
        ?.event.attendees.map((attendee) => attendee.email);

    await invite.mutateAsync({
      eventId: 'event-4',
      guests: [{ email: 'dana@example.com' }],
      scope: 'this_event',
      recurrenceId: keys[1],
      occurrenceKey: keys[1],
    });

    expect(emailsAt(keys[0])).toEqual([]);
    expect(emailsAt(keys[1])).toEqual(['dana@example.com']);
  });

  it('removes the optimistic guests when the organizer does not allow inviting', async () => {
    inviteCalendarEventGuestsMock.mockResolvedValue(
      err([
        {
          code: 'guests_cannot_invite' as const,
          message: 'Only the organizer can invite guests.',
        },
      ])
    );
    const invite = renderHook(() => useInviteCalendarEventGuestsMutation());

    let error: unknown;
    try {
      await invite.mutateAsync({
        eventId: 'event-1',
        guests: [{ email: 'dana@example.com' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(isGuestInviteRefused(error)).toBe(true);
    expect(attendeesOf('event-1')?.map((attendee) => attendee.email)).toEqual([
      'self@example.com',
      'other@example.com',
    ]);
  });

  it('does not read other failures as a refusal', async () => {
    inviteCalendarEventGuestsMock.mockResolvedValue(failure());
    const invite = renderHook(() => useInviteCalendarEventGuestsMutation());

    let error: unknown;
    try {
      await invite.mutateAsync({
        eventId: 'event-1',
        guests: [{ email: 'dana@example.com' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(isGuestInviteRefused(error)).toBe(false);
  });
});

it('updates and rolls back invitation projections with no calendar viewport loaded', async () => {
  testQueryClient.removeQueries({ queryKey: calendarKeys.occurrences._def });
  const item = standaloneItem();
  const key = calendarKeys.invitations('thread').queryKey;
  const initial = {
    invite: {
      kind: 'resolved' as const,
      ...item,
      responding_email: 'self@example.com',
      can_respond: true,
      is_stale: false,
    },
  };
  testQueryClient.setQueryData(key, initial);
  const response = () =>
    testQueryClient
      .getQueryData<typeof initial>(key)
      ?.invite.event.attendees.find((a) => a.isSelf)?.responseStatus;
  const first = deferredResult();
  const second = deferredResult();
  rsvpCalendarEventMock
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const rsvp = renderHook(() => useRsvpCalendarEventMutation());
  const earlier = rsvp
    .mutateAsync({ eventId: 'event-1', response: 'accepted' })
    .catch(() => {});
  await vi.waitFor(() => expect(response()).toBe('accepted'));
  const later = rsvp.mutateAsync({ eventId: 'event-1', response: 'tentative' });
  await vi.waitFor(() => expect(response()).toBe('tentative'));
  first.resolve(failure());
  await earlier;
  expect(response()).toBe('tentative');
  second.resolve(ok(item.event));
  await later;
  expect(response()).toBe('tentative');
  rsvpCalendarEventMock.mockResolvedValueOnce(failure());
  await expect(
    rsvp.mutateAsync({ eventId: 'event-1', response: 'declined' })
  ).rejects.toThrow();
  expect(response()).toBe('tentative');
});

it('binds provider writes and optimistic rollback to one address across both hosts', async () => {
  const item = standaloneItem();
  item.event.attendees[1].isSelf = true;
  const viewportKey = calendarKeys.occurrences('user', viewportA).queryKey;
  testQueryClient.setQueryData(viewportKey, {
    items: [item],
    syncStatus: 'ready',
  });
  const inviteKey = calendarKeys.invitations('thread').queryKey;
  const initial = {
    invite: {
      kind: 'resolved' as const,
      ...item,
      responding_email: 'other@example.com',
      can_respond: true,
      is_stale: false,
    },
  };
  testQueryClient.setQueryData(inviteKey, initial);
  const first = deferredResult();
  const second = deferredResult();
  rsvpCalendarEventMock
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const mutation = renderHook(() => useRsvpCalendarEventMutation());
  const response = (email: string) =>
    testQueryClient
      .getQueryData<typeof initial>(inviteKey)
      ?.invite.event.attendees.find((attendee) => attendee.email === email)
      ?.responseStatus;
  const firstCall = mutation
    .mutateAsync({
      eventId: 'event-1',
      respondingEmail: 'other@example.com',
      response: 'accepted',
    })
    .catch(() => {});
  await vi.waitFor(() =>
    expect(response('other@example.com')).toBe('accepted')
  );
  expect(response('self@example.com')).toBe('needs_action');
  expect(
    viewportData(viewportA)?.items[0].event.attendees[1].responseStatus
  ).toBe('accepted');
  expect(rsvpCalendarEventMock).toHaveBeenCalledWith(
    'event-1',
    expect.objectContaining({ respondingEmail: 'other@example.com' })
  );
  const secondCall = mutation.mutateAsync({
    eventId: 'event-1',
    respondingEmail: 'self@example.com',
    response: 'tentative',
  });
  await vi.waitFor(() =>
    expect(response('self@example.com')).toBe('tentative')
  );
  first.resolve(failure());
  await firstCall;
  expect(response('other@example.com')).toBe('declined');
  expect(response('self@example.com')).toBe('tentative');
  second.resolve(ok(item.event));
  await secondCall;
});

it('revalidates only the thread whose saved invitations changed', () => {
  const changed = calendarKeys.invitations('thread').queryKey;
  const other = calendarKeys.invitations('other').queryKey;
  testQueryClient.setQueryData(changed, {});
  testQueryClient.setQueryData(other, {});
  invalidateInvitationScheduling('thread');
  expect(testQueryClient.getQueryState(changed)?.isInvalidated).toBe(true);
  expect(testQueryClient.getQueryState(other)?.isInvalidated).toBe(false);
});

it('leaves unrelated invitation lookups, including failed ones, untouched by a response', async () => {
  const failed = calendarKeys.invitations('failed').queryKey;
  const other = standaloneItem();
  testQueryClient.setQueryData(failed, {
    invite: {
      kind: 'resolved' as const,
      ...other,
      event: { ...other.event, id: 'other-event' },
      responding_email: 'self@example.com',
      can_respond: true,
      can_join: true,
      is_stale: false,
    },
  });
  testQueryClient
    .getQueryCache()
    .find({ queryKey: failed })
    ?.setState({ status: 'error', error: new Error('refresh failed') });
  rsvpCalendarEventMock.mockResolvedValueOnce(ok(standaloneItem().event));
  const rsvp = renderHook(() => useRsvpCalendarEventMutation());
  await rsvp.mutateAsync({ eventId: 'event-1', response: 'accepted' });
  expect(testQueryClient.getQueryState(failed)?.status).toBe('error');
});

describe('optimistic recurring times', () => {
  it('projects recurring timed events into all-day dates and back', () => {
    const timed = recurringItem();
    timed.event.time = {
      kind: 'timed',
      startsAt: '2026-08-04T09:00:00Z',
      endsAt: '2026-08-04T09:30:00Z',
      timeZone: 'UTC',
    };
    const allDayMaster = {
      kind: 'allDay' as const,
      startDate: '2026-08-04',
      endDate: '2026-08-05',
    };
    const allDay = projectCalendarOccurrenceTime(timed, allDayMaster);
    expect(allDay.occurrence.time).toEqual({
      kind: 'allDay',
      startDate: '2026-08-05',
      endDate: '2026-08-06',
    });
    expect(allDay.occurrence.recurrenceId).toBe('2026-08-05');
    expect(allDay.occurrence.occurrenceKey).toBe(
      timed.occurrence.occurrenceKey
    );
    const restored = projectCalendarOccurrenceTime(allDay, timed.event.time);
    expect(restored.occurrence.time).toMatchObject({
      kind: 'timed',
      startsAt: '2026-08-05T09:00:00.000Z',
      endsAt: '2026-08-05T09:30:00.000Z',
    });
  });

  it('uses the series wall clock across daylight-saving changes', () => {
    expect(
      shiftCalendarEventTime(
        {
          kind: 'timed',
          startsAt: '2026-11-02T15:00:00Z',
          endsAt: '2026-11-02T15:30:00Z',
        },
        {
          kind: 'timed',
          startsAt: '2026-10-26T14:00:00Z',
          endsAt: '2026-10-26T14:30:00Z',
          timeZone: 'America/New_York',
        },
        {
          kind: 'timed',
          startsAt: '2026-10-26T15:00:00Z',
          endsAt: '2026-10-26T16:00:00Z',
          timeZone: 'America/New_York',
        }
      )
    ).toMatchObject({
      startsAt: '2026-11-02T16:00:00.000Z',
      endsAt: '2026-11-02T17:00:00.000Z',
    });
  });

  it('shifts all-day dates and duration independently', () => {
    expect(
      shiftCalendarEventTime(
        { kind: 'allDay', startDate: '2026-11-08', endDate: '2026-11-09' },
        { kind: 'allDay', startDate: '2026-11-01', endDate: '2026-11-02' },
        { kind: 'allDay', startDate: '2026-11-02', endDate: '2026-11-04' }
      )
    ).toEqual({
      kind: 'allDay',
      startDate: '2026-11-09',
      endDate: '2026-11-11',
    });
  });

  it('keeps moved and resized exceptions while updating their series master', () => {
    const time = {
      kind: 'timed' as const,
      startsAt: '2026-08-04T10:00:00Z',
      endsAt: '2026-08-04T10:30:00Z',
    };
    const moved = recurringItem();
    moved.occurrence.time = {
      kind: 'timed',
      startsAt: '2026-08-05T12:00:00Z',
      endsAt: '2026-08-05T12:30:00Z',
    };
    const resized = recurringItem();
    resized.occurrence.time = {
      kind: 'timed',
      startsAt: '2026-08-05T09:00:00Z',
      endsAt: '2026-08-05T10:00:00Z',
    };
    for (const item of [moved, resized]) {
      const projected = projectCalendarOccurrenceTime(item, time);
      expect(projected.event.time).toEqual(time);
      expect(projected.occurrence).toEqual(item.occurrence);
    }
  });
});
