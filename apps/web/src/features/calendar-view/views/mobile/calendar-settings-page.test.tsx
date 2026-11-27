/**
 * @vitest-environment jsdom
 */

import type { CalendarSource } from '@app/features/calendar/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileCalendarSettingsPage } from './calendar-settings-page';

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

type BusyChange = {
  userId: string;
  calendarIds: string[];
  contributesToAvailability: boolean;
};

const state = vi.hoisted(() => ({
  mutate: vi.fn<(change: BusyChange) => void>(),
}));
const { passThrough } = vi.hoisted(() => ({
  passThrough: (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));

vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Root: passThrough,
    Main: passThrough,
    TopBarTitle: passThrough,
    TopBar: (props: { navigation?: JSX.Element; children?: JSX.Element }) => (
      <div>
        {props.navigation}
        {props.children}
      </div>
    ),
  },
}));
vi.mock('@app/features/calendar/components/CalendarSettingsDropdown', () => ({
  createCalendarSettingsControls: () => ({
    calendarView: {
      sources: () => SOURCES,
      displaySettings: {
        showWeekends: true,
        weekStartsOn: 0,
        timeFormat: '12-hour',
      },
    },
    accounts: () => [],
    changeShowWeekends: () => {},
    changeWeekStartsOn: () => {},
    changeTimeFormat: () => {},
    runAccountAction: () => {},
    connectAnotherAccount: () => {},
    turnOffTarget: () => null,
    clearTurnOffTarget: () => {},
  }),
}));
vi.mock('@app/features/calendar/components/TurnOffCalendarDialog', () => ({
  TurnOffCalendarDialog: () => null,
}));
vi.mock('@app/features/calendar/availability/settings', () => ({
  useAvailabilitySettings: () => ({
    settings: () => ({
      startTime: '09:00',
      endTime: '18:00',
      excludeWeekends: false,
    }),
    setStartTime: () => {},
    setEndTime: () => {},
    setExcludeWeekends: () => {},
  }),
}));
vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [
    { showNextMeetingBadge: true, timeFormat: '12-hour' },
    () => {},
  ],
}));
vi.mock('@app/features/calendar-team/calendar-team', () => ({
  useCalendarTeamSettings: () => ({ enabled: () => false }),
}));
vi.mock('@app/features/calendar-team/components/team-sharing-settings', () => ({
  calendarSharingOptions: () => [],
}));
vi.mock('@app/features/settings/components/settings-select', () => ({
  SettingsSelect: () => null,
}));
vi.mock('@app/observability/flow', () => ({ usePending: () => {} }));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: {
    Back: (props: { onBack: () => void }) => (
      <button type="button" onClick={() => props.onBack()}>
        Back
      </button>
    ),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: () => {} },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@core/mobile/androidBack', () => ({
  useAndroidBackNavigation: () => {},
}));
vi.mock('@queries/calendar/availability', () => ({
  useAvailabilityCalendarsQuery: () => ({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: {
      calendars: SOURCES.map((source) => ({
        calendarId: source.id,
        contributesToAvailability: true,
      })),
    },
  }),
  useSetAvailabilityCalendarMutation: () => ({
    isPending: false,
    mutate: state.mutate,
  }),
}));

afterEach(() => {
  cleanup();
  state.mutate.mockClear();
});

function openBusyCalendars() {
  const result = render(() => <MobileCalendarSettingsPage onBack={() => {}} />);
  fireEvent.click(result.getByRole('button', { name: /Busy calendars/ }));
  return result;
}

describe('MobileCalendarSettingsPage Busy calendars', () => {
  it('marks subscription calendars and leaves the others unmarked', () => {
    const { getByRole } = openBusyCalendars();
    expect(
      getByRole('checkbox', { name: 'Holidays Subscription calendar' })
    ).toBeTruthy();
    expect(
      getByRole('checkbox', { name: 'Team feed Subscription calendar' })
    ).toBeTruthy();
    expect(getByRole('checkbox', { name: 'Calendar' })).toBeTruthy();
  });

  it('still changes whether a subscription calendar makes you busy', () => {
    const { getByText } = openBusyCalendars();
    fireEvent.click(getByText('Holidays'));
    expect(state.mutate).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        calendarIds: ['own-holidays'],
        contributesToAvailability: false,
      },
      expect.anything()
    );
  });
});
