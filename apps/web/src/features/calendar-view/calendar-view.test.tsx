/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => {}),
  setSearch: vi.fn(),
  notificationSource: { id: 'notification-source' },
  focusEvent: (_eventId: string | undefined) => {},
  isInlinePreview: false,
  contentParams: undefined as Record<string, unknown> | undefined,
  searchEventId: '',
}));

vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  CalendarViewContextProvider: (props: {
    onFocusedEventIdChange: (eventId: string | undefined) => void;
    children: JSX.Element;
  }) => {
    mocks.focusEvent = props.onFocusedEventIdChange;
    return props.children;
  },
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => true,
}));
vi.mock('@app/features/calendar/utils/calendar-supported-range', () => ({
  isCalendarRangeSupported: () => true,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => true }),
}));
vi.mock('@app/lib/split-router', () => ({
  createSearchParams: () => [
    {
      eventId: mocks.searchEventId,
      occurrenceKey: '',
      startDate: '',
      endDate: '',
    },
    mocks.setSearch,
  ],
  createSearchParamsCodec: () => ({ serialize: () => ({}) }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ period: 'timeGridWeek' }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.notificationSource,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    isInlinePreview: mocks.isInlinePreview,
    handle: {
      content: () => ({
        type: 'component',
        id: 'calendar',
        params: mocks.contentParams,
      }),
    },
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@notifications/notification-helpers', () => ({
  markNotificationsForEntityAsRead: mocks.markRead,
}));
vi.mock('@queries/calendar/occurrences', () => ({
  useCalendarOccurrencesQuery: () => ({}),
}));
vi.mock('./calendar-focus-target', () => ({
  CalendarFocusContextProvider: (props: { children: JSX.Element }) =>
    props.children,
}));
vi.mock('./calendar-target', () => ({
  createCalendarFocusTarget: () => () => undefined,
}));
vi.mock('./calendar-target-request', () => ({
  createCalendarTargetAim: () => ({
    target: () => undefined,
    aimAt: vi.fn(),
  }),
}));
vi.mock('./calendar-view-skeleton', () => ({
  CalendarViewSkeleton: () => null,
}));
vi.mock('./components/Workspace', () => ({ Workspace: () => null }));

import { CalendarView } from './calendar-view';

function openCalendar() {
  render(() => <CalendarView route={{ id: 'view-calendar' }} />);
}

beforeEach(() => {
  mocks.markRead.mockClear();
  mocks.setSearch.mockClear();
  mocks.isInlinePreview = false;
  mocks.contentParams = undefined;
  mocks.searchEventId = '';
});

afterEach(cleanup);

describe('marking an event read when Calendar lands on it', () => {
  it('marks the event a link opened, keeping the link in the URL', () => {
    mocks.searchEventId = 'event';
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'event' }
    );
    expect(mocks.setSearch).not.toHaveBeenCalled();
  });

  it('leaves the read to the row that opened the event', () => {
    mocks.searchEventId = 'event';
    mocks.contentParams = { eventId: 'event', focusRequestId: 1 };
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("leaves the read to Home's row in its inline calendar", () => {
    mocks.searchEventId = 'event';
    mocks.isInlinePreview = true;
    openCalendar();

    mocks.focusEvent('event');

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('marks the copy a link resolved to and names it in the URL', () => {
    mocks.searchEventId = 'another-copy';
    openCalendar();

    mocks.focusEvent('own-copy');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'own-copy' }
    );
    expect(mocks.setSearch).toHaveBeenCalledWith(
      { eventId: 'own-copy' },
      { mode: 'replace', history: 'replace' }
    );
  });

  it('marks each event selected after the landing', () => {
    mocks.searchEventId = 'event';
    mocks.contentParams = { eventId: 'event', focusRequestId: 1 };
    openCalendar();
    mocks.focusEvent('event');

    mocks.focusEvent('next-event');

    expect(mocks.markRead).toHaveBeenCalledExactlyOnceWith(
      mocks.notificationSource,
      { type: 'calendar_event', id: 'next-event' }
    );
  });
});
