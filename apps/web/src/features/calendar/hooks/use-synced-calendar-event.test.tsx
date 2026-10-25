// @vitest-environment jsdom
import type {
  CalendarOccurrencesData,
  CalendarOccurrencesQueryInput,
} from '@queries/calendar/occurrences';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  mapCalendarOccurrence,
} from '../types';
import { useSyncedCalendarEvent } from './use-synced-calendar-event';

const requests = vi.hoisted(() => ({
  occurrences: vi.fn<() => Promise<CalendarOccurrencesData>>(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user',
}));
vi.mock('@queries/calendar/occurrences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/calendar/occurrences')>()),
  useCalendarOccurrencesQuery: (
    input: Accessor<CalendarOccurrencesQueryInput>
  ) =>
    useQuery(() => ({
      queryKey: ['occurrences', input().userId, input().range],
      queryFn: requests.occurrences,
      enabled: input().range !== undefined,
    })),
}));

const time = {
  kind: 'timed' as const,
  startsAt: '2026-10-25T15:00:00Z',
  endsAt: '2026-10-25T15:30:00Z',
};

function guestCopy(editDetails: boolean): CalendarOccurrencesData {
  return {
    syncStatus: 'ready',
    items: [
      {
        event: {
          id: 'event',
          ownerId: 'user',
          icalUid: 'uid',
          calendarId: 'calendar',
          title: 'Planning',
          time,
          attendees: [
            {
              email: 'host@example.com',
              isOptional: false,
              isOrganizer: true,
              isSelf: false,
              responseStatus: 'accepted',
            },
            {
              email: 'me@example.com',
              isOptional: false,
              isOrganizer: false,
              isSelf: true,
              responseStatus: 'accepted',
            },
          ],
          recurrenceLines: [],
          sequence: 0,
          isReadOnly: false,
          guestPolicy: { ...DEFAULT_GUEST_POLICY, canModify: editDetails },
          isSnapshot: false,
          viewerCan: {
            editDetails,
            inviteGuests: true,
            removeGuests: editDetails,
            setGuestPolicy: false,
            rsvp: true,
            organize: false,
          },
          status: 'confirmed',
          transparency: 'opaque',
          visibility: 'default',
          createdAt: time.startsAt,
          updatedAt: time.startsAt,
        },
        occurrence: {
          eventId: 'event',
          occurrenceKey: time.startsAt,
          time,
          isCancelled: false,
        },
      },
    ],
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

it('keeps the last synced copy, and the lock it brought, through a failed refetch', async () => {
  const [item] = guestCopy(true).items;
  if (!item) throw new Error('fixture has an occurrence');
  const opened = mapCalendarOccurrence(item);
  // The organizer turned modifying off before the day loaded.
  requests.occurrences.mockResolvedValueOnce(guestCopy(false));
  let synced!: Accessor<CalendarEvent | undefined>;
  render(() => (
    <QueryClientProvider client={queryClient}>
      {(() => {
        synced = useSyncedCalendarEvent(() => opened);
        return null;
      })()}
    </QueryClientProvider>
  ));

  await waitFor(() => expect(synced()?.viewerCan.editDetails).toBe(false));

  requests.occurrences.mockRejectedValueOnce(new Error('offline'));
  await queryClient.refetchQueries();

  expect(queryClient.getQueryCache().getAll()[0]?.state.status).toBe('error');
  expect(synced()?.viewerCan.editDetails).toBe(false);
});
