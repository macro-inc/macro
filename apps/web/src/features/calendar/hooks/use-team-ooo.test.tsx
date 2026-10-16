import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import type {
  TeamOutOfOfficeQueryInput,
  TeamOutOfOfficeQueryOptions,
} from '@queries/calendar/team-ooo';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createSignal, For, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEAM_OOO_SOURCE_ID } from '../types';
import { useTeamOooEvents } from './use-team-ooo';

const requests = vi.hoisted(() => ({
  teamOoo: vi.fn<() => Promise<TeamOutOfOfficeItem[]>>(),
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
  useTeamOutOfOfficeQuery: (
    input: Accessor<TeamOutOfOfficeQueryInput>,
    options?: Accessor<TeamOutOfOfficeQueryOptions>
  ) =>
    useQuery(() => ({
      queryKey: ['team-ooo', input().userId, input().range],
      queryFn: requests.teamOoo,
      enabled: options?.().enabled !== false,
    })),
}));

afterEach(() => {
  cleanup();
  requests.teamOoo.mockReset();
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
