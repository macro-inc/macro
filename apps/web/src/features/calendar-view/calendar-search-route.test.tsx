// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarSearchRouteView } from './calendar-search-route';

const state = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  index: 1,
  touch: true,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => state.navigate,
  usePaneHistory: () => () => ({ index: state.index }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@app/features/calendar/calendar-preferences', () => ({
  getPreferredCalendarPeriodView: () => 'timeGridWeek',
}));
vi.mock('@app/routes/routes', () => ({
  calendarSplitRoute: { id: 'view-calendar' },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitDisplayName: () => {},
}));
vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (component: unknown) => component,
}));
vi.mock('@components/app/split-layout/view-restoration', () => ({
  useViewRestoration: () => {},
}));
vi.mock('@components/app/split-panel', () => {
  const Part = (props: ParentProps) => <div>{props.children}</div>;
  return { SplitPanel: { Root: Part, Body: Part } };
});
vi.mock('./calendar-focus-target', () => ({
  CalendarFocusContextProvider: (props: ParentProps) => <>{props.children}</>,
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  CalendarViewContextProvider: (props: ParentProps) => <>{props.children}</>,
}));
vi.mock('./views/mobile/calendar-search-page', () => ({
  MobileCalendarSearchPage: (props: { onBack: () => void }) => (
    <button onClick={props.onBack}>Back to calendar</button>
  ),
}));

afterEach(() => {
  cleanup();
  state.index = 1;
  state.touch = true;
  vi.clearAllMocks();
});

it('returns through pane history when opened from a calendar date and view', () => {
  render(() => <CalendarSearchRouteView />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
  expect(state.navigate).toHaveBeenCalledWith(-1);
});

it('returns a direct deep link to the preferred calendar view', () => {
  state.index = 0;
  render(() => <CalendarSearchRouteView />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to calendar' }));
  expect(state.navigate).toHaveBeenCalledWith({
    route: { id: 'view-calendar' },
    params: { period: 'timeGridWeek' },
  });
});

it('keeps desktop navigation on Calendar instead of rendering a phone search page', () => {
  state.touch = false;
  render(() => <CalendarSearchRouteView />);
  expect(screen.queryByRole('button', { name: 'Back to calendar' })).toBeNull();
  expect(state.navigate).toHaveBeenCalledWith(
    { route: { id: 'view-calendar' }, params: { period: 'timeGridWeek' } },
    { replace: true }
  );
});
