// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileCalendarSearchPage } from '../views/mobile/calendar-search-page';
import { CalendarSearch } from './CalendarSearch';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  openEvent: vi.fn(() => Promise.resolve()),
  rows: [] as Array<Record<string, unknown>>,
  supported: true,
}));
vi.mock('@app/components/view-shell', () => {
  const Part = (props: ParentProps) => <div>{props.children}</div>;
  return {
    SearchBar: () => null,
    ViewShell: {
      Root: Part,
      Main: Part,
      TopBarTitle: Part,
      TopBarIsland: Part,
      TopBar: (props: ParentProps<{ navigation?: JSX.Element }>) => (
        <header>
          {props.navigation}
          {props.children}
        </header>
      ),
    },
  };
});
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarSearchUiFlag: () => () => true,
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    displaySettings: { timeFormat: '12-hour' },
    sourceById: () => undefined,
    sourcesReady: () => true,
    isSourceVisible: () => true,
  }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-occurrence-data', () => ({
  useCalendarOccurrenceData: () => undefined,
}));
vi.mock('@app/features/calendar/utils/calendar-supported-range', () => ({
  isCalendarRangeSupported: () => state.supported,
}));
vi.mock('../open-calendar-event', () => ({
  eventTimeFromOccurrenceKey: () => undefined,
  openCalendarEventSplit: state.openEvent,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: {} }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: () => ({ dispose: () => {} }),
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: (request: () => unknown, options: () => unknown) => ({
    get data() {
      state.request(request(), options());
      return state.rows;
    },
    isPending: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));
vi.mock('@queries/calendar/mention-preview', () => ({
  useCalendarSearchPreviewsQuery: () => ({ isSuccess: false }),
  useCalendarMentionPreviewQuery: () => ({ isPending: false, data: null }),
}));
vi.mock('./CalendarSearchFilters', () => ({
  DEFAULT_CALENDAR_SEARCH_FILTERS: {
    searchOn: 'name_content',
    matchType: 'partial',
    statuses: [],
    organizers: [],
    attendees: [],
  },
  CalendarSearchFilters: () => <button type="button">Filter events</button>,
}));
vi.mock('@ui', () => ({
  Button: (props: ParentProps<JSX.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{props.children}</button>
  ),
  EmptyStatePanel: (props: { title: string; description: string }) => (
    <div>
      {props.title} {props.description}
    </div>
  ),
  Layer: (props: ParentProps) => <div>{props.children}</div>,
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(' '),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.rows = [];
  state.supported = true;
  vi.clearAllMocks();
});

it('focuses the full-page field and uses the existing default calendar query after debounce', () => {
  vi.useFakeTimers();
  render(() => <CalendarSearch page />);
  const input = screen.getByRole('searchbox', { name: 'Search events' });
  expect(document.activeElement).toBe(input);
  expect(screen.getByText(/Type at least 3 characters/)).toBeTruthy();
  fireEvent.input(input, { target: { value: 'planning' } });
  vi.advanceTimersByTime(250);
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      params: { page_size: 25 },
      body: expect.objectContaining({
        query: 'planning',
        search_on: 'name_content',
        match_type: 'partial',
        filters: expect.objectContaining({ calendar_event_filters: undefined }),
      }),
    }),
    { enabled: true }
  );
  expect(screen.getByText(/No matching events/)).toBeTruthy();
});

it('opens a result or displays its out-of-range read-only preview', () => {
  vi.useFakeTimers();
  state.rows = [
    {
      type: 'calendar_event',
      id: 'event-1',
      name: 'Planning',
      time: { kind: 'allDay', startDate: '2026-04-01', endDate: '2026-04-02' },
    },
  ];
  render(() => <CalendarSearch page />);
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search events' }), {
    target: { value: 'planning' },
  });
  vi.advanceTimersByTime(250);
  fireEvent.click(screen.getByRole('button', { name: /Planning/ }));
  expect(state.openEvent).toHaveBeenCalledWith({
    eventId: 'event-1',
    occurrenceKey: undefined,
    time: state.rows[0]!.time,
  });
  cleanup();
  state.supported = false;
  render(() => <CalendarSearch page />);
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search events' }), {
    target: { value: 'planning' },
  });
  vi.advanceTimersByTime(250);
  fireEvent.click(screen.getByRole('button', { name: /Planning/ }));
  expect(
    screen.getByText("Outside the calendar's navigable range")
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
  expect(screen.getByRole('searchbox', { name: 'Search events' })).toBeTruthy();
});

it('focuses the full-page phone search below the navigation header', () => {
  const back = vi.fn();
  render(() => <MobileCalendarSearchPage onBack={back} />);
  const input = screen.getByRole('searchbox', { name: 'Search events' });
  expect(input.closest('header')).toBeNull();
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
  expect(back).toHaveBeenCalledOnce();
});
