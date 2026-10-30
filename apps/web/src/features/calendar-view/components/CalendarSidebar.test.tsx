/**
 * @vitest-environment jsdom
 */

import {
  type CalendarEvent,
  TEAM_OOO_SOURCE_ID,
} from '@app/features/calendar/types';
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
import type { CalendarFocusOccurrence } from '../calendar-focus-target';
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
const [overlayVisible, setOverlayVisible] = createSignal(false);
const selectEvent = vi.fn(
  (event: CalendarEvent, _anchor: HTMLElement, _origin?: 'grid' | 'agenda') =>
    setSelectedEvent(event)
);
const gotoDate = vi.fn<(date: Date) => void>();
const focusOccurrence =
  vi.fn<(occurrence: CalendarFocusOccurrence, onTimeout: () => void) => void>();

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    selectedEvent,
    selectEvent,
    isSourceVisible: (sourceId: string) =>
      sourceId === TEAM_OOO_SOURCE_ID ? overlayVisible() : true,
  }),
}));
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({ gotoDate }),
}));
vi.mock('../calendar-focus-target', () => ({
  useCalendarFocus: () => ({ focusOccurrence }),
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

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      <TeamOooUpcomingList />
    </QueryClientProvider>
  ));
}

afterEach(() => {
  cleanup();
  setSelectedEvent(undefined);
  setOverlayVisible(false);
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

  it('opens on the grid chip when the overlay shows the absence', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    setOverlayVisible(true);
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: /Jackson/ }));

    const [item] = teamOooItems();
    expect(focusOccurrence).toHaveBeenCalledTimes(1);
    expect(focusOccurrence.mock.calls[0][0]).toMatchObject({
      eventId: item.eventId,
      occurrenceKey: item.occurrenceKey,
    });
    expect(selectEvent).not.toHaveBeenCalled();
    expect(gotoDate).not.toHaveBeenCalled();
  });

  it('falls back to the row when the chip never renders', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    setOverlayVisible(true);
    renderList();
    const row = await screen.findByRole('button', { name: /Jackson/ });
    fireEvent.click(row);

    const [occurrence, onTimeout] = focusOccurrence.mock.calls[0];
    onTimeout();

    expect(gotoDate).toHaveBeenCalledWith(occurrence.date);
    expect(selectEvent).toHaveBeenCalledTimes(1);
    expect(selectEvent.mock.calls[0][1]).toBe(row);
    expect(selectEvent.mock.calls[0][2]).toBe('agenda');
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('opens on the row when the overlay is hidden', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    renderList();
    const row = await screen.findByRole('button', { name: /Jackson/ });

    fireEvent.click(row);

    expect(focusOccurrence).not.toHaveBeenCalled();
    expect(gotoDate).toHaveBeenCalledTimes(1);
    expect(selectEvent).toHaveBeenCalledTimes(1);
    expect(selectEvent.mock.calls[0][1]).toBe(row);
    expect(selectEvent.mock.calls[0][2]).toBe('agenda');
  });
});
