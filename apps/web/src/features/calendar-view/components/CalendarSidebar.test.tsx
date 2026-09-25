import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarSidebar } from './CalendarSidebar';

const state = vi.hoisted(() => ({
  mobile: false,
  overlay: false,
  touch: false,
  teammates: true,
  gotoDate: vi.fn(),
  collapse: vi.fn(),
}));

vi.mock('@app/components/view-shell', () => {
  const Slot = (props: { children?: JSX.Element }) => <>{props.children}</>;
  const Control = (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
  ) => (
    <button aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  );
  return {
    useViewShell: () => ({
      aside: {
        isOverlay: () => state.overlay,
        collapse: state.collapse,
      },
    }),
    ViewSidebar: {
      Root: Slot,
      Header: Slot,
      Title: Slot,
      CloseButton: () => null,
      Content: Slot,
      Control,
    },
    CollapsibleSection: {
      Root: Slot,
      Trigger: (props: { children?: JSX.Element }) => (
        <button>{props.children}</button>
      ),
      Indicator: () => null,
      Header: Slot,
      Content: Slot,
    },
  };
});
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({
    activeDateInfo: () => undefined,
    gotoDate: state.gotoDate,
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    displaySettings: { weekStartsOn: 0 },
    sources: () => [{ id: 'one' }, { id: 'two' }],
    isSourceVisible: () => true,
    setSourceVisibility: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/SourceControls', () => ({
  SourceControls: () => <div>Calendar visibility</div>,
}));
vi.mock('@app/features/calendar/hooks/use-team-ooo', () => ({
  TEAM_OOO_SOURCE_ID: 'team-ooo',
  useHasTeammates: () => () => state.teammates,
  useUpcomingTeamOoo: () => ({
    windows: () => [],
    isPending: () => false,
    isError: () => false,
  }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  ShowFeatureFlag: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => state.mobile }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('../calendar-call-sidebar', () => ({
  CalendarCallSidebar: (props: { onSelectEvent?: () => void }) => (
    <button onClick={props.onSelectEvent}>Open upcoming event</button>
  ),
}));
vi.mock('@ui', () => ({
  Calendar: (props: {
    onValueChange: (date: Date) => void;
    onMonthChange: (date: Date) => void;
  }) => (
    <>
      <button onClick={() => props.onValueChange(new Date(2026, 0, 15))}>
        January 15
      </button>
      <button onClick={() => props.onMonthChange(new Date(2026, 1, 1))}>
        Next month
      </button>
    </>
  ),
  ToggleSwitch: () => <button>Show team out of office on the calendar</button>,
}));

beforeEach(() => {
  state.mobile = false;
  state.overlay = false;
  state.touch = false;
  state.teammates = true;
  state.gotoDate.mockClear();
  state.collapse.mockClear();
});
afterEach(cleanup);

it('shows the relocated sections and keeps desktop navigation docked', () => {
  render(() => <CalendarSidebar />);
  expect(screen.getByText('Upcoming events')).toBeTruthy();
  expect(screen.getByText('Calendars')).toBeTruthy();
  expect(screen.getByText('Calendar visibility')).toBeTruthy();
  expect(screen.getByText('Team out of office')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'January 15' }));
  expect(state.gotoDate).toHaveBeenCalledWith(new Date(2026, 0, 15));
  expect(state.collapse).not.toHaveBeenCalled();
});

it('closes the touch overlay after choosing a date or an upcoming event', () => {
  state.mobile = true;
  state.touch = true;
  state.overlay = true;
  render(() => <CalendarSidebar />);

  expect(
    screen.getByRole('button', { name: 'Close calendar navigation' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'January 15' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open upcoming event' }));
  expect(state.collapse).toHaveBeenCalledTimes(2);
});

it('keeps the desktop overlay open when an event anchors its details there', () => {
  state.overlay = true;
  render(() => <CalendarSidebar />);
  fireEvent.click(screen.getByRole('button', { name: 'Open upcoming event' }));
  expect(state.collapse).not.toHaveBeenCalled();
});
