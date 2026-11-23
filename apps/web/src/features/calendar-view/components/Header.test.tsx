import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

type SearchProps = {
  expanded?: boolean;
  onOpenChange?: (open: boolean) => void;
};
const state = vi.hoisted(() => ({
  touch: false,
  previous: vi.fn(),
  next: vi.fn(),
  today: vi.fn(),
  navigateToDate: vi.fn(),
  changeView: vi.fn(),
  width: (): number => 1200,
  navigate: vi.fn(() => Promise.resolve()),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useNavigate: () => state.navigate,
}));
vi.mock('@app/routes/routes', () => ({
  calendarSearchRoute: { id: 'view-calendar-search', path: 'calendar/search' },
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarSearchUiFlag: () => () => true,
}));

vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  ButtonGroup: (await import('@app/components/ui/components/ButtonGroup'))
    .ButtonGroup,
  Layer: (await import('@app/components/ui/components/Layer')).Layer,
  Tabs: (await import('@app/components/ui/components/Tabs')).Tabs,
  Input: (await import('@app/components/ui/components/Input')).Input,
  Hotkey: (await import('@app/components/ui/components/Hotkey')).Hotkey,
  cn: (await import('@app/components/ui/utils/classname')).cn,
}));
vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    aside: { isCollapsed: () => false, isOverlay: () => false },
    breakpoints: { narrow: () => false },
  }),
  ViewSidebar: { Toggle: () => <button>Show sidebar</button> },
  ViewShell: {
    TopBar: (props: { children: JSX.Element; navigation?: JSX.Element }) => (
      <header>
        {props.navigation}
        {props.children}
      </header>
    ),
    TopBarIsland: (props: { children: JSX.Element }) => (
      <div>{props.children}</div>
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
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => ({
    navigationDate: () => new Date(2026, 9, 20),
    previousPeriod: state.previous,
    nextPeriod: state.next,
    navigateToToday: state.today,
    changeView: state.changeView,
    periodView: () => 'timeGridWeek',
    navigateToDate: state.navigateToDate,
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({ displaySettings: { periodView: 'timeGridWeek' } }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-hotkeys', () => ({
  useCalendarHotkeys: () => {},
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({
    get width() {
      return state.width();
    },
    height: 60,
  }),
}));
vi.mock('../views/mobile/month-drawer', () => ({
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
  CalendarSearch: (props: SearchProps) => (
    <button
      data-expanded={props.expanded}
      onClick={() => props.onOpenChange?.(true)}
      onBlur={() => props.onOpenChange?.(false)}
    >
      Search events
    </button>
  ),
}));
vi.mock('./CalendarCreateItems', () => ({
  CalendarCreateEventItem: () => null,
  CalendarCreateCallItem: () => null,
  CalendarCreateBookingLinkItem: () => null,
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
  state.width = () => 1200;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-touch-device');
});

describe('calendar headers', () => {
  it.each([320, 640, 1280])(
    'renders the real month/year trigger at desktop width %i',
    async (width) => {
      vi.stubGlobal('scrollTo', vi.fn());
      state.width = () => width;
      document.documentElement.setAttribute('data-touch-device', 'false');
      render(() => <Header presentation="workspace" />);
      const heading = screen.getByRole('heading', { name: 'October 2026' });
      const trigger = screen.getByRole('button', { name: 'Choose month' });
      expect(heading.contains(trigger)).toBe(true);
      expect(trigger.textContent).toContain('October 2026');
      fireEvent.click(trigger);
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', { name: 'October 2026' })
            .getAttribute('aria-pressed')
        ).toBe('true')
      );
      fireEvent.click(screen.getByRole('button', { name: 'March 2026' }));
      expect(state.navigateToDate).toHaveBeenCalledWith(new Date(2026, 2, 1));
    }
  );
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
      fireEvent.click(screen.getByRole('radio', { name: 'Agenda' }));
      expect(state.changeView).toHaveBeenCalledWith('agenda');
    }
  );

  it('keeps an active search expanded when the pane becomes compact', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const [width, setWidth] = createSignal(1200);
    state.width = width;
    render(() => <Header presentation="workspace" />);
    const search = screen.getByRole('button', { name: 'Search events' });
    expect(search.getAttribute('data-expanded')).toBeNull();

    fireEvent.click(search);
    setWidth(640);
    expect(search.getAttribute('data-expanded')).toBe('true');

    fireEvent.blur(search);
    expect(search.getAttribute('data-expanded')).toBe('false');
  });

  it('renders the touch month island with navigation and search', () => {
    state.touch = true;
    render(() => <Header presentation="workspace" />);
    expect(screen.getByRole('button', { name: 'Choose month' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'New event or call' })
    ).toBeNull();
    expect(screen.queryByRole('heading', { name: 'October 2026' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search events' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search events' }));
    expect(state.navigate).toHaveBeenCalledWith({
      route: expect.objectContaining({ id: 'view-calendar-search' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(state.today).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Calendar settings' })
    ).toBeNull();
  });
});
