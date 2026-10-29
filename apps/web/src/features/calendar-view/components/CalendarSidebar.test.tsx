/**
 * @vitest-environment jsdom
 */

import type { CalendarEvent } from '@app/features/calendar/types';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
  useQueryClient,
} from '@tanstack/solid-query';
import { addDays, format } from 'date-fns';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamOooUpcomingList } from './CalendarSidebar';

const requests = vi.hoisted(() => ({
  teamOoo: vi.fn<() => Promise<TeamOutOfOfficeItem[]>>(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|gab@macro.com',
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Jackson Kustec',
  tryMacroId: (id: string) => id,
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span />,
}));
vi.mock('@app/features/scheduling/calendar-actions', () => ({
  CalendarSchedulingActions: () => null,
}));
vi.mock('@queries/calendar/team-ooo', () => ({
  useTeamOutOfOfficeQueries: (input: () => { ranges: { start: string }[] }) =>
    useQueries(() => ({
      queries: input().ranges.map((range) => ({
        queryKey: ['team-ooo', range.start],
        queryFn: requests.teamOoo,
      })),
    })),
}));

const [selectedEvent, setSelectedEvent] = createSignal<CalendarEvent>();
const selectEvent = vi.fn((event: CalendarEvent, _anchor: HTMLElement) =>
  setSelectedEvent(event)
);

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({ selectedEvent, selectEvent }),
}));
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({ gotoDate: vi.fn() }),
}));
vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({ aside: { isOverlay: () => false } }),
}));

function teamOooItems(): TeamOutOfOfficeItem[] {
  const day = format(addDays(new Date(), 28), 'yyyy-MM-dd');
  const nextDay = format(addDays(new Date(), 29), 'yyyy-MM-dd');
  return [
    {
      eventId: 'ooo-1',
      occurrenceKey: day,
      ownerId: 'macro|jackson@macro.com',
      time: { kind: 'allDay', startDate: day, endDate: nextDay },
    },
  ];
}

afterEach(() => {
  cleanup();
  setSelectedEvent(undefined);
  vi.clearAllMocks();
});

describe('TeamOooUpcomingList', () => {
  it('keeps the selected row attached when the poll refetches', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let refetch!: () => Promise<unknown>;
    function Harness() {
      const queryClient = useQueryClient();
      refetch = () => queryClient.refetchQueries({ queryKey: ['team-ooo'] });
      return <TeamOooUpcomingList />;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));

    fireEvent.click(await screen.findByRole('button', { name: /Jackson/ }));
    const anchor = selectEvent.mock.calls[0][1];
    expect(anchor.getAttribute('aria-current')).toBe('true');
    const initialRequests = requests.teamOoo.mock.calls.length;

    await refetch();

    expect(requests.teamOoo).toHaveBeenCalledTimes(initialRequests * 2);
    expect(screen.getByRole('button', { name: /Jackson/ })).toBe(anchor);
    expect(anchor.isConnected).toBe(true);
  });
});
