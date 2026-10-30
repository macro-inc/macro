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
import userEvent from '@testing-library/user-event';
import { addDays, format } from 'date-fns';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarFocusOccurrence } from '../calendar-focus-target';
import { TeamOooUpcomingList } from './CalendarSidebar';

const requests = vi.hoisted(() => ({
  teamOoo: vi.fn<() => Promise<TeamOutOfOfficeItem[]>>(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|gab@macro.com',
}));
vi.mock('@core/user', () => ({
  getDisplayName: (id: string) =>
    id === 'macro|jackson@macro.com'
      ? 'Jackson Kustec'
      : `Teammate ${id.slice('macro|teammate-'.length, id.indexOf('@'))}`,
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
const [selectedEventAnchor, setSelectedEventAnchor] =
  createSignal<HTMLElement>();
const [overlayVisible, setOverlayVisible] = createSignal(false);
const selectEvent = vi.fn(
  (event: CalendarEvent, anchor: HTMLElement, _origin?: 'grid' | 'agenda') => {
    setSelectedEvent(event);
    setSelectedEventAnchor(anchor);
  }
);
const gotoDate = vi.fn<(date: Date) => void>();
const focusOccurrence =
  vi.fn<(occurrence: CalendarFocusOccurrence, onTimeout: () => void) => void>();
const closeEventDetails = vi.fn(() => {
  setSelectedEvent(undefined);
  setSelectedEventAnchor(undefined);
});

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    selectedEvent,
    selectedEventAnchor,
    selectEvent,
    closeEventDetails,
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

/** One all-day absence per person, on consecutive days four weeks out. */
function teamOooItems(count = 1): TeamOutOfOfficeItem[] {
  return Array.from({ length: count }, (_, index) => {
    const day = format(addDays(new Date(), 28 + index), 'yyyy-MM-dd');
    const nextDay = format(addDays(new Date(), 29 + index), 'yyyy-MM-dd');
    return {
      eventId: `ooo-${index + 1}`,
      occurrenceKey: day,
      ownerId:
        index === 0
          ? 'macro|jackson@macro.com'
          : `macro|teammate-${index + 1}@macro.com`,
      time: { kind: 'allDay', startDate: day, endDate: nextDay },
    };
  });
}

function renderList() {
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
  return { refetch: () => refetch() };
}

const rows = () =>
  screen.queryAllByRole('button', { name: /^(Jackson Kustec|Teammate \d+)/ });
const toggle = () =>
  screen.queryByRole('button', { name: /more$|^Show less$/ });

const scrollIntoView = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  setSelectedEvent(undefined);
  setSelectedEventAnchor(undefined);
  setOverlayVisible(false);
  vi.clearAllMocks();
});

describe('TeamOooUpcomingList', () => {
  it('keeps the selected row attached when the poll refetches', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    const { refetch } = renderList();

    fireEvent.click(await screen.findByRole('button', { name: /Jackson/ }));
    const anchor = selectEvent.mock.calls[0][1];
    expect(anchor.getAttribute('aria-current')).toBe('true');
    const initialRequests = requests.teamOoo.mock.calls.length;

    await refetch();

    expect(requests.teamOoo).toHaveBeenCalledTimes(initialRequests * 2);
    expect(screen.getByRole('button', { name: /Jackson/ })).toBe(anchor);
    expect(anchor.isConnected).toBe(true);
  });

  it('shows ten rows and the rest behind a "+N more" toggle', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    renderList();

    await screen.findByRole('button', { name: /Jackson/ });

    expect(rows()).toHaveLength(10);
    expect(toggle()?.textContent).toBe('+5 more');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands to every row and collapses again', async () => {
    const user = userEvent.setup();
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    renderList();
    await screen.findByRole('button', { name: /Jackson/ });
    const control = toggle();
    if (!control) throw new Error('missing "+N more" toggle');

    await user.click(control);

    expect(rows()).toHaveLength(15);
    expect(toggle()).toBe(control);
    expect(control.textContent).toBe('Show less');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(control);

    await user.click(control);

    expect(rows()).toHaveLength(10);
    expect(control.textContent).toBe('+5 more');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(control);
  });

  it('opens a row past the tenth from the expanded list', async () => {
    const user = userEvent.setup();
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    renderList();
    await screen.findByRole('button', { name: /Jackson/ });

    await user.click(screen.getByRole('button', { name: '+5 more' }));
    const row = screen.getByRole('button', { name: /^Teammate 14/ });
    await user.click(row);

    expect(selectEvent).toHaveBeenCalledTimes(1);
    expect(selectEvent.mock.calls[0][1]).toBe(row);
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('closes the details when Show less removes their row', async () => {
    const user = userEvent.setup();
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    renderList();
    await screen.findByRole('button', { name: /Jackson/ });
    await user.click(screen.getByRole('button', { name: '+5 more' }));
    fireEvent.click(screen.getByRole('button', { name: /^Teammate 14/ }));

    screen.getByRole('button', { name: 'Show less' }).focus();
    await user.keyboard('{Enter}');

    expect(rows()).toHaveLength(10);
    expect(closeEventDetails).toHaveBeenCalledTimes(1);
  });

  it('keeps the details open when Show less keeps their row', async () => {
    const user = userEvent.setup();
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    renderList();
    await user.click(await screen.findByRole('button', { name: '+5 more' }));
    fireEvent.click(screen.getByRole('button', { name: /^Teammate 3/ }));

    screen.getByRole('button', { name: 'Show less' }).focus();
    await user.keyboard('{Enter}');

    expect(rows()).toHaveLength(10);
    expect(closeEventDetails).not.toHaveBeenCalled();
  });

  it('stays expanded when the poll refetches', async () => {
    const user = userEvent.setup();
    requests.teamOoo.mockImplementation(async () => teamOooItems(15));
    const { refetch } = renderList();
    await screen.findByRole('button', { name: /Jackson/ });
    await user.click(screen.getByRole('button', { name: '+5 more' }));

    await refetch();

    expect(rows()).toHaveLength(15);
    expect(toggle()?.textContent).toBe('Show less');
  });

  it('follows count changes and keeps the expanded choice', async () => {
    const user = userEvent.setup();
    let count = 15;
    requests.teamOoo.mockImplementation(async () => teamOooItems(count));
    const { refetch } = renderList();
    await screen.findByRole('button', { name: /Jackson/ });
    await user.click(screen.getByRole('button', { name: '+5 more' }));

    count = 10;
    await refetch();

    expect(rows()).toHaveLength(10);
    expect(toggle()).toBeNull();

    count = 12;
    await refetch();

    expect(rows()).toHaveLength(12);
    expect(toggle()?.textContent).toBe('Show less');

    await user.click(screen.getByRole('button', { name: 'Show less' }));
    count = 13;
    await refetch();

    expect(rows()).toHaveLength(10);
    expect(toggle()?.textContent).toBe('+3 more');
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
    expect(gotoDate).toHaveBeenCalledWith(
      focusOccurrence.mock.calls[0][0].date
    );
    expect(selectEvent).not.toHaveBeenCalled();
  });

  it('falls back to the row when the chip never renders', async () => {
    requests.teamOoo.mockImplementation(async () => teamOooItems());
    setOverlayVisible(true);
    renderList();
    const row = await screen.findByRole('button', { name: /Jackson/ });
    fireEvent.click(row);

    const [, onTimeout] = focusOccurrence.mock.calls[0];
    onTimeout();

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
