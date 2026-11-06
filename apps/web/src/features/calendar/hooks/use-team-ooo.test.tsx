import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import type {
  TeamOutOfOfficeQueriesInput,
  TeamOutOfOfficeQueryOptions,
} from '@queries/calendar/team-ooo';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
} from '@tanstack/solid-query';
import { type Accessor, createSignal, For, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEAM_OOO_SOURCE_ID } from '../types';
import {
  teamOooWindows,
  useTeamOooEvents,
  useUpcomingTeamOoo,
} from './use-team-ooo';

const requests = vi.hoisted(() => ({
  teamOoo:
    vi.fn<
      (range: CalendarOccurrenceQueryRange) => Promise<TeamOutOfOfficeItem[]>
    >(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user',
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Ada',
  tryMacroId: (id: string) => id,
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: false }),
}));
vi.mock('./use-calendar-ui-flag', () => ({
  useCalendarTeamOooFlag: () => () => true,
}));
vi.mock('@queries/calendar/team-ooo', () => ({
  useTeamOutOfOfficeQueries: (
    input: Accessor<TeamOutOfOfficeQueriesInput>,
    options?: Accessor<TeamOutOfOfficeQueryOptions>
  ) =>
    useQueries(() => ({
      queries: input().ranges.map((range) => ({
        queryKey: ['team-ooo', input().userId, range],
        queryFn: () => requests.teamOoo(range),
        enabled: options?.().enabled !== false,
      })),
    })),
}));

afterEach(() => {
  cleanup();
  requests.teamOoo.mockReset();
  vi.useRealTimers();
});

function vacation(range: CalendarOccurrenceQueryRange): TeamOutOfOfficeItem {
  return {
    eventId: 'vacation',
    occurrenceKey: range.startDate,
    ownerId: 'teammate',
    title: 'Vacation',
    time: {
      kind: 'allDay',
      startDate: range.startDate,
      endDate: range.endDate,
    },
  };
}

function TeamOooTitles(props: {
  range: CalendarOccurrenceQueryRange;
  hiddenSourceIds: Accessor<ReadonlySet<string>>;
}) {
  const teamOoo = useTeamOooEvents({
    range: () => props.range,
    isSourceVisible: (sourceId) => !props.hiddenSourceIds().has(sourceId),
  });
  return (
    <ul>
      <For each={teamOoo.events()}>{(event) => <li>{event.title}</li>}</For>
    </ul>
  );
}

describe('useTeamOooEvents', () => {
  it('drops the overlay and skips the request while team out of office is hidden', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const range = createCalendarOccurrenceQueryRange(start, end);
    requests.teamOoo.mockResolvedValue([vacation(range)]);
    const [hiddenSourceIds, setHiddenSourceIds] = createSignal<
      ReadonlySet<string>
    >(new Set([TEAM_OOO_SOURCE_ID]));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(() => (
      <QueryClientProvider client={client}>
        <Suspense>
          <TeamOooTitles range={range} hiddenSourceIds={hiddenSourceIds} />
        </Suspense>
      </QueryClientProvider>
    ));

    await Promise.resolve();
    expect(requests.teamOoo).not.toHaveBeenCalled();
    expect(screen.queryByText('Ada: Vacation')).toBeNull();

    setHiddenSourceIds(new Set<string>());
    expect(await screen.findByText('Ada: Vacation')).toBeTruthy();

    setHiddenSourceIds(new Set([TEAM_OOO_SOURCE_ID]));
    await waitFor(() => expect(screen.queryByText('Ada: Vacation')).toBeNull());
  });
});

const localRange = (start: Date, days: number) => {
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return createCalendarOccurrenceQueryRange(start, end);
};

function allDay(eventId: string, startDate: string, endDate: string) {
  return {
    eventId,
    occurrenceKey: startDate,
    ownerId: 'teammate',
    title: eventId,
    time: { kind: 'allDay', startDate, endDate },
  } satisfies TeamOutOfOfficeItem;
}

describe('teamOooWindows', () => {
  const now = new Date(2026, 9, 23, 12);

  it('gives the pager weeks and the upcoming list shared windows', () => {
    const weeks = [11, 18, 25].map((day) =>
      teamOooWindows(localRange(new Date(2026, 9, day), 7), now)
    );
    const upcoming = teamOooWindows(localRange(new Date(2026, 9, 23), 90), now);

    for (const windows of weeks) {
      expect(
        windows.map((window) => [window.startDate, window.endDate])
      ).toEqual([['2026-09-28', '2026-12-28']]);
    }
    expect(
      upcoming.map((window) => [window.startDate, window.endDate])
    ).toEqual([
      ['2026-09-28', '2026-12-28'],
      ['2026-12-28', '2027-03-29'],
    ]);
  });

  it('covers a viewport that crosses a window boundary with both windows', () => {
    const windows = teamOooWindows(localRange(new Date(2026, 11, 20), 14), now);

    expect(windows.map((window) => [window.startDate, window.endDate])).toEqual(
      [
        ['2026-09-28', '2026-12-28'],
        ['2026-12-28', '2027-03-29'],
      ]
    );
  });

  it('keeps windows inside the supported range', () => {
    const [first] = teamOooWindows(localRange(new Date(2025, 9, 27), 7), now);

    expect(first?.startDate).toBe('2025-10-24');
    expect(first?.endDate).toBe('2025-12-29');
  });
});

describe('shared team out-of-office windows', () => {
  it('requests each window once and shows each consumer only its own range', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 12));
    requests.teamOoo.mockImplementation(async (range) =>
      [
        allDay('This week', '2026-10-23', '2026-10-24'),
        allDay('Across windows', '2026-12-27', '2026-12-29'),
        allDay('January', '2027-01-11', '2027-01-12'),
      ].filter(
        (item) =>
          item.time.startDate < range.endDate &&
          item.time.endDate > range.startDate
      )
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Upcoming() {
      const upcoming = useUpcomingTeamOoo();
      return (
        <ol aria-label="Upcoming">
          <For each={upcoming.windows()}>
            {(window) => <li>{window.title}</li>}
          </For>
        </ol>
      );
    }

    render(() => (
      <QueryClientProvider client={client}>
        <Suspense>
          <For each={[11, 18, 25]}>
            {(day) => (
              <TeamOooTitles
                range={localRange(new Date(2026, 9, day), 7)}
                hiddenSourceIds={() => new Set<string>()}
              />
            )}
          </For>
          <Upcoming />
        </Suspense>
      </QueryClientProvider>
    ));

    const upcoming = await screen.findByRole('list', { name: 'Upcoming' });
    await waitFor(() =>
      expect(upcoming.textContent).toBe('This weekAcross windowsJanuary')
    );
    // Three pager weeks and the upcoming list read two windows.
    expect(requests.teamOoo).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('Ada: This week')).toHaveLength(1);
    expect(screen.queryByText('Ada: January')).toBeNull();
  });
});
