import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal, type JSX, type ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

const navigate = vi.hoisted(() => ({
  today: vi.fn(),
  previous: vi.fn(),
  next: vi.fn(),
}));
const size = vi.hoisted(() => ({ width: (): number => 1000 }));
const sidebar = vi.hoisted(() => ({ collapsed: false }));
const device = vi.hoisted(() => ({ mobile: false, touch: false }));

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: ParentProps) => <div>{props.children}</div>,
  SplitHeaderRight: (props: ParentProps) => <div>{props.children}</div>,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({
    get width() {
      return size.width();
    },
  }),
}));
vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    aside: { isCollapsed: () => sidebar.collapsed, isOverlay: () => false },
  }),
  ViewShell: {
    TopBar: (
      props: ParentProps & {
        ref?: (element: HTMLElement) => void;
        class?: string;
      }
    ) => (
      <header
        ref={props.ref}
        data-testid="calendar-top-bar"
        class={props.class}
      >
        {props.children}
      </header>
    ),
  },
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/classname')),
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }
  ) => (
    <button type="button" aria-label={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('@ui/components/Pager', () => ({
  usePager: () => ({ previous: navigate.previous, next: navigate.next }),
}));
vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({
    activeDateInfo: () => undefined,
    navigateToToday: navigate.today,
    changeView: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({ displaySettings: { periodView: 'timeGridWeek' } }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-hotkeys', () => ({
  useCalendarHotkeys: () => {},
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'calendar-test' }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.mobile }));
vi.mock('./CalendarSearch', () => ({
  CalendarSearch: (props: {
    expanded?: boolean;
    onExpand?: () => void;
    onDismiss?: () => void;
  }) => (
    <div>
      {props.expanded ? (
        <button onClick={props.onDismiss}>Close search</button>
      ) : (
        <button onClick={props.onExpand}>Search events</button>
      )}
    </div>
  ),
}));
vi.mock('@app/features/calendar/components/PeriodSelector', () => ({
  PeriodSelector: () => <button>Choose period</button>,
}));
vi.mock('@app/features/calendar/components/CalendarSettingsDropdown', () => ({
  CalendarSettingsDropdown: () => null,
}));
vi.mock('@app/features/calendar/components/MonthDrawer', () => ({
  MonthDrawer: () => null,
}));
vi.mock('@app/features/calendar/availability/CopyAvailabilityButton', () => ({
  CopyAvailabilityButton: () => null,
}));
vi.mock('./CalendarCreateMenu', () => ({
  CalendarCreateMenu: (
    props: ParentProps & { trigger: JSX.Element; label?: string }
  ) => (
    <div>
      <button type="button" aria-label={props.label}>
        {props.trigger}
      </button>
      {props.children}
    </div>
  ),
}));
vi.mock('./CalendarCreateItems', () => ({
  CalendarCreateEventItem: () => null,
  CalendarCreateCallItem: () => null,
  CalendarCreateReminderItem: () => null,
}));

afterEach(() => {
  cleanup();
  sidebar.collapsed = false;
  device.mobile = false;
  device.touch = false;
  vi.clearAllMocks();
});

describe('workspace calendar header', () => {
  it('uses one desktop top bar and retains period navigation at narrow widths', () => {
    const [width, setWidth] = createSignal(600);
    size.width = width;
    render(() => <Header presentation="workspace" />);

    for (const measuredWidth of [1000, 700, 600, 599, 360, 280]) {
      setWidth(measuredWidth);
      const bars = screen.getAllByTestId('calendar-top-bar');
      expect(bars).toHaveLength(1);
      const bar = within(bars[0]);
      fireEvent.click(bar.getByRole('button', { name: 'Go to today' }));
      fireEvent.click(bar.getByRole('button', { name: 'Previous week' }));
      fireEvent.click(bar.getByRole('button', { name: 'Next week' }));
      expect(bar.getByRole('button', { name: 'Choose period' })).toBeTruthy();
      expect(bar.getByRole('button', { name: 'Search events' })).toBeTruthy();
    }
    expect(navigate.today).toHaveBeenCalledTimes(6);
    expect(navigate.previous).toHaveBeenCalledTimes(6);
    expect(navigate.next).toHaveBeenCalledTimes(6);
  });

  it('keeps New to the left of the period controls in the wrapped row', () => {
    const [width, setWidth] = createSignal(460);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    const bar = screen.getByTestId('calendar-top-bar');
    const controls = bar.querySelector<HTMLElement>(
      '[data-calendar-period-controls]'
    );
    expect(controls).not.toBeNull();
    if (!controls) throw new Error('Missing calendar period controls');

    for (const measuredWidth of [460, 280]) {
      setWidth(measuredWidth);
      const newButton = within(controls).getByRole('button', { name: 'New' });
      const todayButton = within(controls).getByRole('button', {
        name: 'Go to today',
      });
      expect(
        newButton.compareDocumentPosition(todayButton) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
      fireEvent.click(screen.getByRole('button', { name: 'Search events' }));
      expect(within(controls).getByRole('button', { name: 'New' })).toBe(
        newButton
      );
      fireEvent.click(newButton);
      expect(
        screen.getByRole('button', { name: 'Search events' })
      ).toBeTruthy();
      expect(within(controls).getByRole('button', { name: 'New' })).toBe(
        newButton
      );
    }
    setWidth(1040);
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });

  it('keeps toolbar wrapping and title sizing stable across search expansion', () => {
    const [width, setWidth] = createSignal(1040);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    const bar = screen.getByTestId('calendar-top-bar');
    const title = bar.querySelector('h1');
    const controls = bar.querySelector<HTMLElement>(
      '[data-calendar-period-controls]'
    );
    expect(title).not.toBeNull();
    expect(controls).not.toBeNull();
    if (!title || !controls) throw new Error('Missing calendar toolbar layout');
    const barClass = bar.className;
    const titleClass = title.className;
    expect(barClass).toContain('flex-wrap');
    expect(titleClass).toContain('min-w-0');
    expect(titleClass).toContain('truncate');
    expect(titleClass).toContain(
      'text-[clamp(1rem,calc(0.75rem+1cqw),1.5rem)]'
    );

    for (const measuredWidth of [1040, 1039, 1000, 700, 600, 500, 480, 479, 280]) {
      setWidth(measuredWidth);
      const expectedControlsClass = measuredWidth < 480 ? 'basis-full' : 'ml-4';
      for (const action of ['Search events', 'Close search']) {
        expect(screen.getByTestId('calendar-top-bar')).toBe(bar);
        expect(bar.querySelector('h1')).toBe(title);
        expect(bar.querySelector('[data-calendar-period-controls]')).toBe(
          controls
        );
        expect(bar.className).toBe(barClass);
        expect(title.className.replace(' opacity-0', '')).toBe(titleClass);
        expect(title.classList.contains('opacity-0')).toBe(
          measuredWidth < 1040 && action === 'Close search'
        );
        expect(controls.classList.contains(expectedControlsClass)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: action }));
      }
    }
  });

  it('only adds the header New menu below 480px when the sidebar is docked', () => {
    const [width, setWidth] = createSignal(1000);
    size.width = width;
    render(() => <Header presentation="workspace" />);

    for (const measuredWidth of [1000, 700, 600, 500, 480, 479, 460]) {
      setWidth(measuredWidth);
      expect(!!screen.queryByRole('button', { name: 'New' })).toBe(
        measuredWidth < 480
      );
    }
  });

  it('keeps the sidebar-closed New menu mounted across toolbar wrapping', () => {
    sidebar.collapsed = true;
    const [width, setWidth] = createSignal(1040);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    const newButton = screen.getByRole('button', { name: 'New' });
    const controls = screen
      .getByTestId('calendar-top-bar')
      .querySelector<HTMLElement>('[data-calendar-period-controls]');
    expect(controls).not.toBeNull();
    if (!controls) throw new Error('Missing calendar period controls');

    for (const measuredWidth of [1040, 1039, 700, 600, 599, 500, 280]) {
      setWidth(measuredWidth);
      expect(within(controls).getByRole('button', { name: 'New' })).toBe(
        newButton
      );
    }
  });
  it('keeps New and Today labels at 360px and uses icon controls below it', () => {
    const [width, setWidth] = createSignal(360);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    const controls = screen
      .getByTestId('calendar-top-bar')
      .querySelector<HTMLElement>('[data-calendar-period-controls]');
    expect(controls).not.toBeNull();
    if (!controls) throw new Error('Missing calendar period controls');
    const newButton = within(controls).getByRole('button', { name: 'New' });
    const todayButton = within(controls).getByRole('button', {
      name: 'Go to today',
    });
    expect(newButton.textContent).toContain('New');
    expect(todayButton.textContent).toContain('Today');

    setWidth(280);
    expect(within(controls).getByRole('button', { name: 'New' })).toBe(
      newButton
    );
    expect(newButton.textContent).not.toContain('New');
    const iconToday = within(controls).getByRole('button', {
      name: 'Go to today',
    });
    expect(iconToday.textContent).not.toContain('Today');
    expect(iconToday.querySelector('svg')).not.toBeNull();
  });

  it('keeps New mounted when search changes at medium widths', () => {
    sidebar.collapsed = true;
    const [width] = createSignal(700);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    const newButton = screen.getByRole('button', { name: 'New' });

    fireEvent.click(screen.getByRole('button', { name: 'Search events' }));
    expect(screen.getByRole('button', { name: 'New' })).toBe(newButton);
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.getByRole('button', { name: 'New' })).toBe(newButton);
  });

  it('activates a period control before collapsing expanded search', () => {
    const [width] = createSignal(700);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    fireEvent.click(screen.getByRole('button', { name: 'Search events' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(navigate.next).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search events' })).toBeTruthy();
  });
  it('keeps the period controls in the single top bar when compact search expands', () => {
    const [width, setWidth] = createSignal(500);
    size.width = width;
    render(() => <Header presentation="workspace" />);
    fireEvent.click(screen.getByRole('button', { name: 'Search events' }));
    expect(screen.getAllByTestId('calendar-top-bar')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Choose period' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
    setWidth(280);
    expect(screen.getAllByTestId('calendar-top-bar')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Choose period' })).toBeTruthy();
  });

  it('omits Search from the mobile header island', () => {
    device.mobile = true;
    device.touch = true;
    render(() => <Header presentation="workspace" />);
    expect(screen.queryByRole('button', { name: 'Search events' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to today' })).toBeTruthy();
  });

  it('retains Search in desktop preview headers', () => {
    render(() => <Header presentation="preview" />);
    expect(screen.getByRole('button', { name: 'Search events' })).toBeTruthy();
  });
});
