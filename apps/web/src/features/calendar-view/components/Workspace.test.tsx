import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace';

const panel = vi.hoisted(() => ({
  isInlinePreview: false,
  handle: { setDisplayName: vi.fn() },
}));

vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  CALENDAR_PAGE_IDS: ['current'],
  CalendarPagerContextProvider: (props: { children: JSX.Element }) =>
    props.children,
  useCalendarPager: () => ({
    pager: {},
    initialDateFor: () => new Date(2026, 0, 1),
    updateSize: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    displaySettings: {
      periodView: 'timeGridWeek',
      showWeekends: true,
      weekStartsOn: 0,
      timeFormat: '12-hour',
    },
    selectedEventAnchor: () => undefined,
    selectedEvent: () => undefined,
    closeEventDetails: vi.fn(),
    setPeriodView: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/RangeUnavailableBanner', () => ({
  RangeUnavailableBanner: () => null,
}));
vi.mock('@app/components/view-shell', () => {
  const Slot = (props: { children?: JSX.Element }) => <>{props.children}</>;
  return {
    ViewShell: {
      Root: Slot,
      Aside: (props: { children: JSX.Element }) => (
        <aside>{props.children}</aside>
      ),
      Main: Slot,
      Content: Slot,
    },
  };
});
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => panel,
}));
vi.mock('@components/app/split-panel', () => {
  const Slot = (props: { children?: JSX.Element }) => <>{props.children}</>;
  return { SplitPanel: { Root: Slot, Body: Slot } };
});
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
}));
vi.mock('@ui', () => ({
  Layer: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));
vi.mock('@ui/components/Pager', () => {
  const Slot = (props: { children?: JSX.Element }) => <>{props.children}</>;
  return {
    Pager: { Root: Slot, Viewport: Slot, Page: Slot },
    PagerSwipeGestures: () => null,
  };
});
vi.mock('./CalendarSidebar', () => ({
  CalendarSidebar: () => <div>Calendar sidebar</div>,
}));
vi.mock('./Header', () => ({
  Header: (props: { presentation: string }) => (
    <div>Calendar {props.presentation} header</div>
  ),
}));
vi.mock('./Page', () => ({ Page: () => <div>Calendar grid</div> }));
vi.mock('./SelectedEventDetails', () => ({
  SelectedEventDetails: () => null,
}));
vi.mock('./SetupStatus', () => ({ SetupStatus: () => null }));

beforeEach(() => {
  panel.isInlinePreview = false;
  panel.handle.setDisplayName.mockClear();
});
afterEach(cleanup);

it('puts the standalone calendar in a sidebar and in-view topbar', () => {
  render(() => <Workspace />);
  expect(screen.getByText('Calendar sidebar')).toBeTruthy();
  expect(screen.getByText('Calendar workspace header')).toBeTruthy();
  expect(screen.getByText('Calendar grid')).toBeTruthy();
  expect(panel.handle.setDisplayName).toHaveBeenCalledWith('Calendar');
});

it('keeps an inline preview in its host chrome without a nested sidebar', () => {
  panel.isInlinePreview = true;
  render(() => <Workspace />);
  expect(screen.queryByText('Calendar sidebar')).toBeNull();
  expect(screen.getByText('Calendar preview header')).toBeTruthy();
  expect(screen.getByText('Calendar grid')).toBeTruthy();
  expect(panel.handle.setDisplayName).not.toHaveBeenCalled();
});
