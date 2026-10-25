import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

const state = vi.hoisted(() => ({
  touch: false,
  previous: vi.fn(),
  next: vi.fn(),
  today: vi.fn(),
}));

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  ButtonGroup: (await import('@app/components/ui/components/ButtonGroup'))
    .ButtonGroup,
  Layer: (await import('@app/components/ui/components/Layer')).Layer,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));
vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    aside: { isCollapsed: () => false, isOverlay: () => false },
    breakpoints: { narrow: () => false },
  }),
  ViewShell: {
    TopBar: (props: { children: JSX.Element }) => (
      <header>{props.children}</header>
    ),
  },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: {} }),
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => <>{props.children}</>,
  SplitHeaderRight: (props: { children: JSX.Element }) => <>{props.children}</>,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => state.touch }));
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({
    navigationDate: () => new Date(2026, 9, 20),
    previousPeriod: state.previous,
    nextPeriod: state.next,
    navigateToToday: state.today,
    changeView: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({ displaySettings: { periodView: 'timeGridWeek' } }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-hotkeys', () => ({
  useCalendarHotkeys: () => {},
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 1200, height: 60 }),
}));
vi.mock('@app/features/calendar/components/MonthDrawer', () => ({
  MonthDrawer: () => <button>Choose month</button>,
}));
vi.mock('@app/features/calendar/components/PeriodSelector', () => ({
  PeriodSelector: () => <button>Choose calendar view</button>,
}));
vi.mock('@app/features/calendar/components/CalendarSettingsDropdown', () => ({
  CalendarSettingsDropdown: () => <button>Calendar settings</button>,
}));
vi.mock('@app/features/calendar/availability/CopyAvailabilityButton', () => ({
  CopyAvailabilityButton: () => null,
}));
vi.mock('@app/features/scheduling/calendar-actions', () => ({
  CalendarSchedulingActions: () => <button>Booking links</button>,
}));
vi.mock('./CalendarSearch', () => ({
  CalendarSearch: () => <button>Search events</button>,
}));
vi.mock('./CalendarCreateItems', () => ({
  CalendarCreateEventItem: () => null,
  CalendarCreateCallItem: () => null,
}));
vi.mock('./CalendarCreateMenu', () => ({
  CalendarCreateMenu: () => <button>New event or call</button>,
}));
vi.mock('@ui/components/Tour', () => ({ tourTarget: () => () => {} }));
vi.mock('../tour', () => ({
  CALENDAR_TOUR: {
    sidebarToggle: 'calendar-sidebar',
    period: 'calendar-period',
  },
}));

afterEach(() => {
  cleanup();
  state.touch = false;
  vi.clearAllMocks();
});

describe('calendar headers', () => {
  it.each(['workspace', 'preview'] as const)(
    'keeps date navigation and creation in the shared desktop %s header',
    (presentation) => {
      const goHome = vi.fn();
      render(() => (
        <Header
          presentation={presentation}
          leading={<button onClick={goHome}>Home</button>}
        />
      ));

      expect(
        screen.getByRole('heading', { name: 'October 2026' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Search events' })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'New event or call' })
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
      fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(state.previous).toHaveBeenCalledOnce();
      expect(state.next).toHaveBeenCalledOnce();
      expect(state.today).toHaveBeenCalledOnce();
      expect(goHome).toHaveBeenCalledOnce();
    }
  );

  it('retains the touch preview month picker and settings', () => {
    state.touch = true;
    render(() => <Header presentation="preview" />);
    expect(screen.getByRole('button', { name: 'Choose month' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Calendar settings' })
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'October 2026' })).toBeNull();
  });
});
