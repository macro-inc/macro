import type { CalendarPeriodView } from '@app/features/calendar/types';
import {
  SplitRouter,
  type SplitRouterEntry,
  type SplitRouterLayout,
  type SplitRouterSettledChange,
  useSplitRouter,
} from '@app/lib/split-router';
import { createMemorySplitRouterLocation } from '@app/lib/split-router/integrations/memory';
import { appSplitRoutes } from '@components/app/split-layout/split-router/app-routes';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { inboxCalendarRoute } from '../inbox-view/route';
import { CalendarView } from './calendar-view';

const focused = vi.hoisted(() => ({
  targets: [] as Array<{ eventId?: string }>,
  steps: [] as string[],
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => true,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => true }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    isInlinePreview: true,
    handle: { content: () => ({ type: 'component', id: 'inbox' }) },
  }),
}));
vi.mock('@queries/calendar/occurrences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/calendar/occurrences')>()),
  useCalendarOccurrencesQuery: () => ({ isLoading: false }),
}));
vi.mock('./calendar-target-request', () => ({
  createCalendarTargetAim: () => ({
    target: () => undefined,
    aimAt: (target: { eventId?: string }) => {
      focused.steps.push('aim');
      focused.targets.push(target);
    },
  }),
}));
vi.mock('./calendar-focus-target', () => ({
  CalendarFocusContextProvider: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  CalendarViewContextProvider: (props: {
    periodView: CalendarPeriodView;
    onPeriodViewChange: (period: CalendarPeriodView) => void;
    onFocusedEventIdChange: (eventId: string | undefined) => void;
    children: JSX.Element;
  }) => (
    <div>
      <div data-testid="period">{props.periodView}</div>
      <button
        type="button"
        onClick={() => {
          props.onPeriodViewChange('dayGridMonth');
          focused.steps.push('close');
          props.onFocusedEventIdChange(undefined);
        }}
      >
        Month
      </button>
      {props.children}
    </div>
  ),
}));
vi.mock('./components/Workspace', () => ({ Workspace: () => null }));

afterEach(() => {
  cleanup();
  focused.targets.length = 0;
  focused.steps.length = 0;
});

function createLayout(): SplitRouterLayout<string> {
  let current: (SplitRouterEntry & { splitId: string }) | undefined;
  const listeners = new Set<(change: SplitRouterSettledChange) => void>();
  const notify = () => {
    for (const listener of listeners) listener({ history: 'push' });
  };
  return {
    snapshot: () => ({ entries: current ? [current] : [] }),
    updateCurrentEntry(_splitId, update) {
      if (!current) return;
      current = { splitId: current.splitId, ...update(current) };
      notify();
    },
    open: () => {},
    reconcile(entries) {
      const next = entries[0];
      current = next ? { splitId: 'split', ...next } : undefined;
      notify();
    },
    activate: () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

it('changes the inline Home period and re-aims the selected event', async () => {
  const location = createMemorySplitRouterLocation(
    '/inbox/calendar/week?s0.calendar.eventId=event-1' +
      '&s0.calendar.startDate=2025-01-01&s0.calendar.endDate=2025-01-02'
  );
  let router!: ReturnType<typeof useSplitRouter<string>>;
  function MountedCalendar() {
    router = useSplitRouter<string>();
    return <CalendarView route={inboxCalendarRoute} />;
  }
  render(() => (
    <SplitRouter.Root
      layout={createLayout()}
      routes={appSplitRoutes}
      location={location}
    >
      <SplitRouter.Scope splitId="split">
        <MountedCalendar />
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  expect(screen.getByTestId('period').textContent).toBe('timeGridWeek');
  expect(focused.targets).toHaveLength(0);

  await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  await router.settled();
  expect(location.read().pathname).toBe('/inbox/calendar/month');
  expect(location.read().search).toContain('s0.calendar.eventId=event-1');
  expect(screen.getByTestId('period').textContent).toBe('dayGridMonth');
  expect(focused.targets).toMatchObject([{ eventId: 'event-1' }]);
  expect(focused.steps).toEqual(['close', 'aim']);

  expect(location.back()).toBe(true);
  await router.settled();
  expect(location.read().pathname).toBe('/inbox/calendar/week');
  expect(focused.targets).toMatchObject([
    { eventId: 'event-1' },
    { eventId: 'event-1' },
  ]);
});
