/**
 * @vitest-environment jsdom
 */

import type { CalendarEvent } from '@app/features/calendar/types';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
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
vi.mock('@queries/calendar/team-ooo', () => ({
  useTeamOutOfOfficeQuery: () =>
    useQuery(() => ({ queryKey: ['team-ooo'], queryFn: requests.teamOoo })),
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
  return [
    {
      eventId: 'ooo-1',
      occurrenceKey: '2026-11-20',
      ownerId: 'macro|jackson@macro.com',
      time: { kind: 'allDay', startDate: '2026-11-20', endDate: '2026-11-21' },
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

    await refetch();

    expect(requests.teamOoo).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /Jackson/ })).toBe(anchor);
    expect(anchor.isConnected).toBe(true);
  });
});
