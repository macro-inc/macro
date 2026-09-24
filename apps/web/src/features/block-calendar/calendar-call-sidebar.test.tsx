/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  type ParentProps,
} from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarCallsSidePanelSection } from './calendar-call-sidebar';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  active: vi.fn(),
  callsEnabled: true,
  enabled: undefined as (() => boolean) | undefined,
}));
vi.mock('../meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => ({
    enabled: mocks.enabled?.() ?? mocks.callsEnabled,
    loading: false,
  }),
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|self@example.com',
}));
vi.mock('../calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    sourceById: () => new Map(),
    isSourceVisible: () => true,
  }),
}));
vi.mock('../meetings/queries/upcoming-calendar-events', () => ({
  useUpcomingCalendarEventsSource: () => ({}),
}));
vi.mock('../meetings/queries/active-quick-calls', () => ({
  useActiveQuickCallsSource: (userId: Accessor<string | undefined>) => {
    createEffect(() => mocks.active(userId()));
    return {};
  },
}));
vi.mock('../meetings/views/call-sidebar', () => ({
  CallSidebar: () => <div>Event list</div>,
}));
vi.mock('@components/app/side-panel/SidePanel', () => ({
  SidePanel: {
    Section: (
      props: ParentProps<{
        title: string;
        order: number;
        actions?: JSX.Element;
      }>
    ) => (
      <section aria-label={props.title} data-order={props.order}>
        <h2>{props.title}</h2>
        {props.actions}
        {props.children}
      </section>
    ),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.callsEnabled = true;
  mocks.enabled = undefined;
});

it('keeps creation actions out of Upcoming events', () => {
  render(() => <CalendarCallsSidePanelSection />);
  expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeTruthy();
  expect(screen.getByText('Event list')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'New Call' })).toBeNull();
});

it('keeps upcoming events available when calling is disabled', () => {
  mocks.callsEnabled = false;
  render(() => <CalendarCallsSidePanelSection />);
  expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeTruthy();
  expect(screen.getByText('Event list')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'New Call' })).toBeNull();
  expect(mocks.active).toHaveBeenCalledExactlyOnceWith(undefined);
});

it('enables active quick calls after loading without remounting upcoming events', () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.enabled = enabled;
  render(() => <CalendarCallsSidePanelSection />);
  const events = screen.getByText('Event list');
  expect(mocks.active).toHaveBeenLastCalledWith(undefined);
  setEnabled(true);
  expect(mocks.active).toHaveBeenLastCalledWith('macro|self@example.com');
  expect(screen.getByText('Event list')).toBe(events);
  setEnabled(false);
  expect(mocks.active).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByText('Event list')).toBe(events);
});
