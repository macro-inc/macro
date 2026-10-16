import type {
  CalendarOccurrencesData,
  CalendarOccurrencesQueryInput,
} from '@queries/calendar/occurrences';
import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createSignal, For, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CALENDAR_SOURCE } from '../types';
import {
  type CalendarOccurrenceData,
  useCalendarOccurrenceData,
} from './use-calendar-occurrence-data';
import { useCalendarSources } from './use-calendar-sources';

const requests = vi.hoisted(() => ({
  calendars: vi.fn<() => Promise<VisibleCalendar[]>>(),
  occurrences: vi.fn<() => Promise<CalendarOccurrencesData>>(),
  transport: (): string => 'rest',
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user',
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () =>
    useQuery(() => ({
      queryKey: ['calendars'],
      queryFn: requests.calendars,
    })),
}));
vi.mock('@queries/calendar/occurrences', () => ({
  useCalendarOccurrencesQuery: (
    input: Accessor<CalendarOccurrencesQueryInput>
  ) => {
    const client = useQueryClient();
    return useQuery(() => {
      const { userId, range } = input();
      const transport = requests.transport();
      return {
        queryKey: ['occurrences', userId, range, transport],
        queryFn: requests.occurrences,
        // The query layer seeds the new reader from the same user and range.
        initialData: () =>
          client.getQueryData<CalendarOccurrencesData>([
            'occurrences',
            userId,
            range,
            transport === 'rest' ? 'graphql' : 'rest',
          ]),
        initialDataUpdatedAt: 0,
        staleTime: (query) => (query.state.dataUpdatedAt === 0 ? 0 : Infinity),
      };
    });
  },
}));
vi.mock('../utils/preferences', () => ({
  useCalendarPreferences: () => [{ sourceColors: {}, accountColors: {} }],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const calendar: VisibleCalendar = {
  id: 'primary',
  name: 'My calendar',
  color: '#dc2127',
  defaultReminders: [],
  emailAddress: 'me@example.com',
  emailLinkId: 'inbox',
  isPrimary: true,
  isSubscription: false,
  isWritable: true,
};

function occurrenceData(): CalendarOccurrencesData {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 3_600_000).toISOString();
  const time = { kind: 'timed' as const, startsAt: start, endsAt: end };
  return {
    syncStatus: 'ready',
    items: [
      {
        event: {
          id: 'event',
          ownerId: 'user',
          icalUid: 'uid',
          calendarId: calendar.id,
          title: 'Planning',
          time,
          attendees: [],
          recurrenceLines: [],
          sequence: 0,
          isReadOnly: false,
          status: 'confirmed',
          transparency: 'opaque',
          visibility: 'default',
          createdAt: start,
          updatedAt: start,
        },
        occurrence: {
          eventId: 'event',
          occurrenceKey: start,
          time,
          isCancelled: false,
        },
      },
    ],
  };
}

let queryClient: QueryClient;

function renderCalendarData() {
  let data!: CalendarOccurrenceData;
  const start = new Date();
  const end = new Date(start.getTime() + 86_400_000);
  const range = {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
  function Calendar() {
    const { sourceById, sourcesReady } = useCalendarSources();
    data = useCalendarOccurrenceData({
      range: () => range,
      sourceById,
      sourcesReady,
    });
    return (
      <div data-testid="calendar" aria-busy={data.isLoading()}>
        <For each={data.visibleEvents()}>
          {(event) => (
            <span data-color={event.calendar.color}>{event.title}</span>
          )}
        </For>
      </div>
    );
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Suspended</div>}>
        <Calendar />
      </Suspense>
    </QueryClientProvider>
  ));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.transport = () => 'rest';
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('calendar occurrence presentation readiness', () => {
  it('keeps colored events visible during a same-range transport handoff', async () => {
    const [transport, setTransport] = createSignal('rest');
    requests.transport = transport;
    requests.calendars.mockResolvedValue([calendar]);
    const occurrences = occurrenceData();
    requests.occurrences.mockResolvedValue(occurrences);
    const data = renderCalendarData();
    await waitFor(() => expect(screen.getByText('Planning')).toBeTruthy());

    const replacement = deferred<CalendarOccurrencesData>();
    requests.occurrences.mockReturnValue(replacement.promise);
    setTransport('graphql');
    await waitFor(() => expect(data.occurrencesQuery.isFetching).toBe(true));
    expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
      calendar.color
    );
    expect(data.isLoading()).toBe(false);
    expect(screen.getByTestId('calendar').getAttribute('aria-busy')).toBe(
      'false'
    );

    replacement.resolve(occurrences);
    await waitFor(() => expect(data.occurrencesQuery.isFetching).toBe(false));
    expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
      calendar.color
    );
    expect(data.isLoading()).toBe(false);
  });

  it('keeps the grid loading until fast occurrences have their calendar colors', async () => {
    const calendars = deferred<VisibleCalendar[]>();
    requests.calendars.mockReturnValue(calendars.promise);
    requests.occurrences.mockResolvedValue(occurrenceData());
    const data = renderCalendarData();

    await waitFor(() => expect(data.occurrencesQuery.isSuccess).toBe(true));
    expect(screen.queryByText('Planning')).toBeNull();
    expect(screen.queryByText('Suspended')).toBeNull();
    expect(screen.getByTestId('calendar').getAttribute('aria-busy')).toBe(
      'true'
    );

    calendars.resolve([calendar]);
    await waitFor(() => {
      expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
        calendar.color
      );
      expect(data.isLoading()).toBe(false);
    });
  });

  it('still waits for occurrences when calendar metadata arrives first', async () => {
    const occurrences = deferred<CalendarOccurrencesData>();
    requests.calendars.mockResolvedValue([calendar]);
    requests.occurrences.mockReturnValue(occurrences.promise);
    const data = renderCalendarData();

    await waitFor(() =>
      expect(queryClient.getQueryState(['calendars'])?.status).toBe('success')
    );
    expect(data.isLoading()).toBe(true);
    expect(screen.queryByText('Planning')).toBeNull();

    occurrences.resolve(occurrenceData());
    await waitFor(() => {
      expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
        calendar.color
      );
      expect(data.isLoading()).toBe(false);
    });
  });

  it.each(['empty', 'error'] as const)(
    'uses the default source after a terminal metadata result: %s',
    async (result) => {
      const calendars = deferred<VisibleCalendar[]>();
      requests.calendars.mockReturnValue(calendars.promise);
      requests.occurrences.mockResolvedValue(occurrenceData());
      const data = renderCalendarData();

      await waitFor(() => expect(data.occurrencesQuery.isSuccess).toBe(true));
      expect(screen.queryByText('Planning')).toBeNull();
      if (result === 'error') calendars.reject(new Error('Unavailable'));
      else calendars.resolve([]);

      await waitFor(() => {
        expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
          DEFAULT_CALENDAR_SOURCE.color
        );
        expect(data.isLoading()).toBe(false);
      });
    }
  );

  it('keeps colored events visible while calendar metadata refreshes', async () => {
    requests.calendars.mockResolvedValue([calendar]);
    requests.occurrences.mockResolvedValue(occurrenceData());
    const data = renderCalendarData();
    await waitFor(() => expect(screen.getByText('Planning')).toBeTruthy());

    const refreshedCalendars = deferred<VisibleCalendar[]>();
    requests.calendars.mockReturnValue(refreshedCalendars.promise);
    const refresh = queryClient.invalidateQueries({ queryKey: ['calendars'] });
    await waitFor(() =>
      expect(queryClient.getQueryState(['calendars'])?.fetchStatus).toBe(
        'fetching'
      )
    );
    expect(data.isLoading()).toBe(false);
    expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
      calendar.color
    );

    refreshedCalendars.resolve([{ ...calendar, color: '#16a765' }]);
    await refresh;
    await waitFor(() =>
      expect(screen.getByText('Planning').getAttribute('data-color')).toBe(
        '#16a765'
      )
    );
  });
});
