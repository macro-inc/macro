import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarSidebar } from './CalendarSidebar';

const state = vi.hoisted(() => ({
  mobile: false,
  overlay: false,
  touch: false,
  quickCalls: true,
  teammates: true,
  teamWindows: [] as Array<{
    ownerId: string;
    name: string;
    title?: string;
    start: Date;
    end: Date;
  }>,
  gotoDate: vi.fn(),
  collapse: vi.fn(),
  compose: vi.fn(),
  reminder: vi.fn(),
  navigate: vi.fn(),
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
      Primary: Slot,
      Icon: Slot,
      Content: Slot,
      Nav: Slot,
      Footer: Slot,
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
vi.mock('@app/features/reminders/reminder-composer', () => ({
  openStandaloneReminderComposer: state.reminder,
}));
vi.mock('@app/features/calendar/availability/CopyAvailabilityButton', () => ({
  CopyAvailabilityButton: (props: { iconOnly?: boolean }) => (
    <button aria-label="Copy availability">
      {props.iconOnly ? null : 'Copy availability'}
    </button>
  ),
}));
vi.mock('@app/features/calendar/components/CalendarSettingsDropdown', () => ({
  CalendarSettingsDropdown: () => <button aria-label="Calendar settings" />,
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <span data-testid="teammate-avatar">{props.id}</span>
  ),
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => ({ enabled: state.quickCalls }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => state.navigate }));
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
    windows: () => state.teamWindows,
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
vi.mock('@ui', () => {
  const Slot = (props: { children?: JSX.Element }) => <>{props.children}</>;
  return {
    Dropdown: Object.assign(Slot, {
      Trigger: (props: { children?: JSX.Element }) => (
        <button>{props.children}</button>
      ),
      Content: Slot,
      Group: Slot,
      Item: (props: { children?: JSX.Element; onSelect?: () => void }) => (
        <button onClick={props.onSelect}>{props.children}</button>
      ),
    }),
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
  };
});

beforeEach(() => {
  state.mobile = false;
  state.overlay = false;
  state.touch = false;
  state.teammates = true;
  state.teamWindows = [];
  state.quickCalls = true;
  state.gotoDate.mockClear();
  state.collapse.mockClear();
  state.compose.mockClear();
  state.navigate.mockClear();
  state.reminder.mockClear();
});
afterEach(cleanup);

it('shows the relocated sections and keeps desktop navigation docked', () => {
  render(() => <CalendarSidebar onCreateEvent={state.compose} />);
  expect(screen.getByText('Upcoming events')).toBeTruthy();
  expect(screen.getByText('Calendars')).toBeTruthy();
  expect(screen.getByText('Calendar visibility')).toBeTruthy();
  expect(screen.getByText('Team out of office')).toBeTruthy();
  const labels = [...document.querySelectorAll('button')].map((button) =>
    button.textContent?.trim()
  );
  expect(labels.indexOf('New')).toBeLessThan(labels.indexOf('January 15'));
  expect(labels.indexOf('Call')).toBeLessThan(labels.indexOf('January 15'));
  expect(screen.getAllByRole('button', { name: 'Copy availability' })).toHaveLength(
    1
  );
  fireEvent.click(screen.getByRole('button', { name: 'Event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Call' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reminder' }));
  expect(state.compose).toHaveBeenCalledTimes(1);
  expect(state.navigate).toHaveBeenCalledWith('/meet/new');
  expect(state.reminder).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'January 15' }));
  expect(state.gotoDate).toHaveBeenCalledWith(new Date(2026, 0, 15));
  expect(state.collapse).not.toHaveBeenCalled();
});

it('closes the touch overlay after choosing a date or an upcoming event', () => {
  state.mobile = true;
  state.touch = true;
  state.overlay = true;
  render(() => <CalendarSidebar onCreateEvent={state.compose} />);

  expect(
    screen.getByRole('button', { name: 'Close calendar navigation' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'January 15' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open upcoming event' }));
  expect(state.collapse).toHaveBeenCalledTimes(2);
});

it('closes the overlay before creating and hides calls when disabled', () => {
  state.overlay = true;
  state.quickCalls = false;
  render(() => <CalendarSidebar onCreateEvent={state.compose} />);
  expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Event' }));
  expect(state.collapse).toHaveBeenCalledTimes(1);
  expect(state.compose).toHaveBeenCalledTimes(1);
});
it('keeps the desktop overlay open when an event anchors its details there', () => {
  state.overlay = true;
  render(() => <CalendarSidebar onCreateEvent={state.compose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open upcoming event' }));
  expect(state.collapse).not.toHaveBeenCalled();
});

it('shows a teammate avatar beside an upcoming out-of-office window', () => {
  state.teamWindows = [
    {
      ownerId: 'macro|teammate@example.com',
      name: 'Teammate',
      title: 'Out of office',
      start: new Date(2026, 0, 15),
      end: new Date(2026, 0, 16),
    },
  ];
  render(() => <CalendarSidebar onCreateEvent={state.compose} />);
  expect(screen.getByTestId('teammate-avatar').textContent).toBe(
    'macro|teammate@example.com'
  );
  expect(screen.getByText('Teammate')).toBeTruthy();
});
