// @vitest-environment jsdom
import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileCalendarSidebar } from './calendar-sidebar';

const state = vi.hoisted(() => ({
  changeView: vi.fn(),
  period: 'timeGridWeek',
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/email-link', () => ({ useAddInboxFlow: () => vi.fn() }));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('@app/components/view-shell/create-frame-width', () => ({
  createFrameWidth: () => () => 390,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 390, height: 844 }),
}));
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => ({
    periodView: () => state.period,
    changeView: state.changeView,
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    sources: () => [],
    isSourceVisible: () => true,
    setSourceVisibility: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [{ sourceColors: {} }, vi.fn()],
}));
vi.mock('@app/features/calendar/hooks/use-team-ooo', () => ({
  useHasTeammates: () => () => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({ ShowFeatureFlag: () => null }));
vi.mock('@app/features/scheduling/queries/source', () => ({
  useSchedulingProfileWithAutoSetupQuery: () => ({
    isSuccess: true,
    data: { revision: 'r1', eventTypes: [] },
  }),
}));
vi.mock('@app/features/calendar/availability/CopyAvailabilityButton', () => ({
  CopyAvailabilityButton: () => <button>Copy availability</button>,
}));
vi.mock('@app/lib/split-router', async (original) => ({
  ...(await original<typeof import('@app/lib/split-router')>()),
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  state.changeView.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses shell navigation, marks the active view, and dismisses after a view choice', async () => {
  let shell!: ReturnType<typeof useViewShell>;
  function Content() {
    shell = useViewShell();
    return (
      <>
        <ViewShell.Aside>
          <MobileCalendarSidebar />
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewSidebar.Toggle action="expand" presentation="pill" />
        </ViewShell.Main>
      </>
    );
  }
  render(() => (
    <ViewShell.Root
      asidePreferenceKey="calendar-test"
      contentLayout="collection"
      aside={{ preserveDuringResize: false }}
    >
      <Content />
    </ViewShell.Root>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Week' }).getAttribute('aria-current')
    ).toBe('page')
  );
  expect(screen.getByRole('button', { name: 'Agenda' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '3 days' })).toBeTruthy();
  const footer = screen
    .getByRole('button', { name: 'Settings' })
    .closest('[data-calendar-settings-footer]');
  expect(footer?.closest('[data-view-sidebar-content]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Day$/ }));
  expect(state.changeView).toHaveBeenCalledWith('timeGridDay');
  await waitFor(() => expect(shell.aside.isOverlay()).toBe(false));
});
