/**
 * @vitest-environment jsdom
 */

import {
  type CalendarSource,
  DEFAULT_CALENDAR_SOURCE,
} from '@app/features/calendar/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileCalendarSidebar } from './calendar-sidebar';

const SOURCES: CalendarSource[] = [
  {
    id: 'own-primary',
    name: 'Calendar',
    color: '#0000ff',
    emailAddress: 'owner@example.com',
    emailLinkId: 'link-owner',
    isPrimary: true,
  },
  {
    id: 'own-holidays',
    name: 'Holidays',
    color: '#00ff00',
    emailAddress: 'owner@example.com',
    emailLinkId: 'link-owner',
    isSubscription: true,
  },
  {
    id: 'web-feed',
    name: 'Team feed',
    color: '#ff0000',
    emailAddress: 'other@example.com',
    emailLinkId: 'link-other',
    isSubscription: true,
  },
];

const state = vi.hoisted(() => ({
  setSourceVisibility: vi.fn<(id: string, visible: boolean) => void>(),
  setCalendarColor: vi.fn<(id: string, color: string | undefined) => void>(),
  sources: [] as CalendarSource[],
}));
const { passThrough } = vi.hoisted(() => ({
  passThrough: (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));

vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({ aside: { collapse: () => {} } }),
  ViewSidebar: {
    Root: passThrough,
    Header: passThrough,
    CloseButton: () => null,
    Title: passThrough,
    Content: passThrough,
    Nav: passThrough,
    Icon: passThrough,
    Item: (props: { children?: JSX.Element; onClick?: () => void }) => (
      <button type="button" onClick={() => props.onClick?.()}>
        {props.children}
      </button>
    ),
  },
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    sources: () => state.sources,
    isSourceVisible: () => true,
    setSourceVisibility: state.setSourceVisibility,
    setSourcesVisibility: () => {},
    closeEventDetails: () => {},
  }),
}));
vi.mock('@app/features/calendar/hooks/use-calendar-color', () => ({
  useSetCalendarColor: () => state.setCalendarColor,
}));
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => ({
    periodView: () => 'timeGridWeek',
    changeView: () => {},
  }),
}));
vi.mock('@app/features/calendar/hooks/use-team-ooo', () => ({
  useHasTeammates: () => () => false,
}));
vi.mock('@app/features/calendar/availability/CopyAvailabilityButton', () => ({
  CopyAvailabilityButton: () => null,
}));
vi.mock('@app/features/scheduling/booking-link', () => ({
  copyBookingLink: () => Promise.resolve(),
}));
vi.mock('@app/features/scheduling/booking-links-search', () => ({
  bookingLinksSearch: { namespace: 'booking', defaults: {} },
  bookingLinksSearchCodec: { serialize: () => '' },
}));
vi.mock('@app/features/scheduling/queries/source', () => ({
  useSchedulingProfileWithAutoSetupQuery: () => ({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { eventTypes: [] },
  }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  ShowFeatureFlag: () => null,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock('@app/routes/routes', () => ({
  bookingLinksRoute: { id: 'view-booking-links' },
  calendarSettingsRoute: { id: 'view-calendar-settings' },
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: { Section: passThrough },
}));
vi.mock('@core/component/VerticalScrollIndicators', () => ({
  ScrollIndicators: () => null,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@core/directive/touchHandler', () => ({ touchHandler: () => {} }));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => () => Promise.resolve(),
}));

beforeEach(() => {
  state.sources = SOURCES;
});

afterEach(() => {
  cleanup();
  state.setSourceVisibility.mockClear();
  state.setCalendarColor.mockClear();
});

describe('MobileCalendarSidebar', () => {
  it('marks subscription calendars and leaves the others unmarked', () => {
    const { getByRole } = render(() => <MobileCalendarSidebar />);
    expect(
      getByRole('checkbox', { name: 'Holidays Subscription calendar' })
    ).toBeTruthy();
    expect(
      getByRole('checkbox', { name: 'Team feed Subscription calendar' })
    ).toBeTruthy();
    expect(getByRole('checkbox', { name: 'Calendar' })).toBeTruthy();
  });

  it('still shows or hides a subscription calendar from its row', () => {
    const { getByText } = render(() => <MobileCalendarSidebar />);
    fireEvent.click(getByText('Holidays'));
    expect(state.setSourceVisibility).toHaveBeenCalledWith(
      'own-holidays',
      false
    );
  });
});

const work = (hasCustomColor: boolean): CalendarSource => ({
  ...DEFAULT_CALENDAR_SOURCE,
  id: 'work',
  name: 'Work',
  color: hasCustomColor ? '#57b6b0' : '#9fe1e7',
  hasCustomColor,
  emailLinkId: 'link-1',
  emailAddress: 'alice@example.com',
});

/** Opens the calendar's options as a long press or a secondary click does. */
async function openWorkColor() {
  render(() => <MobileCalendarSidebar />);
  fireEvent.contextMenu(screen.getByText('Work'));
  fireEvent.click(await screen.findByLabelText('Work color'));
}

describe("a calendar's color on the phone", () => {
  // Class web-cal-calendar-color: when this fails, a color picked on the
  // phone stays in that browser and never reaches the account or other
  // devices.
  it("saves the picked color to the person's account", async () => {
    state.sources = [work(false)];
    await openWorkColor();

    fireEvent.click(await screen.findByRole('button', { name: 'Iris' }));

    expect(state.setCalendarColor).toHaveBeenCalledWith('work', '#9382e8');
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Reset Work color',
      }).disabled
    ).toBe(true);
  });

  it("resets the account's color to the provider's", async () => {
    state.sources = [work(true)];
    await openWorkColor();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Reset Work color' })
    );

    expect(state.setCalendarColor).toHaveBeenCalledWith('work', undefined);
  });
});
