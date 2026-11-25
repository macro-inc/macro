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

const state = vi.hoisted(() => ({
  setCalendarColor: vi.fn<(id: string, color: string | undefined) => void>(),
  sources: [] as CalendarSource[],
}));

type Slot = { children?: JSX.Element };

vi.mock('@app/features/calendar/hooks/use-calendar-color', () => ({
  useSetCalendarColor: () => state.setCalendarColor,
}));
vi.mock('@app/features/calendar/components/CalendarViewContext', () => ({
  useCalendarView: () => ({
    sources: () => state.sources,
    isSourceVisible: () => true,
    setSourceVisibility: () => {},
    setSourcesVisibility: () => {},
    closeEventDetails: () => {},
  }),
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
vi.mock('@app/features/scheduling/queries/source', () => ({
  useSchedulingProfileWithAutoSetupQuery: () => ({
    isSuccess: false,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@app/features/scheduling/booking-link', () => ({
  copyBookingLink: async () => {},
}));
vi.mock('@app/features/scheduling/booking-links-search', () => ({
  bookingLinksSearch: { namespace: 'bookingLinks', defaults: {} },
  bookingLinksSearchCodec: { serialize: () => '' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  ShowFeatureFlag: () => null,
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => async () => {},
}));
vi.mock('@app/routes/routes', () => ({
  bookingLinksRoute: {},
  calendarSettingsRoute: {},
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'alice',
}));
vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => async () => {},
}));
vi.mock('@core/directive/touchHandler', () => ({
  touchHandler: () => {},
}));
vi.mock('@core/component/VerticalScrollIndicators', () => ({
  ScrollIndicators: () => null,
}));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: { Section: (props: Slot) => <>{props.children}</> },
}));
vi.mock('@app/components/view-shell/ListSkeleton', () => ({
  ListSkeleton: {},
}));
vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({ aside: { collapse: () => {} } }),
  ViewSidebar: {
    Root: (props: Slot) => <div>{props.children}</div>,
    Header: (props: Slot) => <div>{props.children}</div>,
    CloseButton: () => null,
    Title: (props: Slot) => <span>{props.children}</span>,
    Content: (props: Slot & { ref?: (element: HTMLDivElement) => void }) => (
      <div ref={props.ref}>{props.children}</div>
    ),
    Nav: (props: Slot) => <nav>{props.children}</nav>,
    Icon: (props: Slot) => <span>{props.children}</span>,
    Item: (
      props: Slot & {
        onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
      }
    ) => (
      <button type="button" onClick={(event) => props.onClick?.(event)}>
        {props.children}
      </button>
    ),
  },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

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
