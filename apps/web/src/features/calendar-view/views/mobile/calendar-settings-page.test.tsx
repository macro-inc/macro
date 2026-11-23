// @vitest-environment jsdom

import { useAvailabilitySettings } from '@app/features/calendar/availability/settings';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileCalendarSettingsPage } from './calendar-settings-page';

const actions = vi.hoisted(() => ({
  weekends: vi.fn(),
  weekStart: vi.fn(),
  timeFormat: vi.fn(),
  connect: vi.fn(),
  account: vi.fn(),
  busy: vi.fn(),
  sharing: vi.fn(),
  preference: vi.fn(),
}));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: {
    Back: (props: { onBack: () => void }) => (
      <button aria-label="Go back" onClick={props.onBack} />
    ),
  },
}));
vi.mock('@app/components/view-shell', () => {
  const Part = (props: ParentProps) => <div>{props.children}</div>;
  return {
    ViewShell: {
      Root: Part,
      Main: Part,
      TopBar: (props: ParentProps<{ navigation?: JSX.Element }>) => (
        <header>
          {props.navigation}
          {props.children}
        </header>
      ),
      TopBarTitle: Part,
      TopBarIsland: Part,
    },
  };
});
vi.mock('@app/features/calendar/components/CalendarSettingsDropdown', () => ({
  createCalendarSettingsControls: () => ({
    calendarView: {
      displaySettings: {
        showWeekends: true,
        weekStartsOn: 0,
        timeFormat: '12-hour',
      },
      sources: () => [{ id: 'c1', name: 'Work', emailLinkId: 'l1' }],
    },
    accounts: () => [
      {
        linkId: 'l1',
        emailAddress: 'owner@example.com',
        provider: 'GMAIL',
        action: 'turnOff',
      },
    ],
    changeShowWeekends: actions.weekends,
    changeWeekStartsOn: actions.weekStart,
    changeTimeFormat: actions.timeFormat,
    connectAnotherAccount: actions.connect,
    runAccountAction: actions.account,
    turnOffTarget: () => null,
    clearTurnOffTarget: vi.fn(),
  }),
}));
vi.mock('@app/features/calendar/components/TurnOffCalendarDialog', () => ({
  TurnOffCalendarDialog: () => null,
}));
vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [
    { timeFormat: '12-hour', showNextMeetingBadge: true },
    actions.preference,
  ],
}));
vi.mock('@app/features/calendar-team/calendar-team', () => ({
  useCalendarTeamSettings: () => ({
    enabled: () => true,
    hasTeam: true,
    error: false,
    sharing: 'busy_only',
    onChange: actions.sharing,
  }),
}));
vi.mock('@queries/calendar/availability', () => ({
  useAvailabilityCalendarsQuery: () => ({
    isSuccess: true,
    isLoading: false,
    data: {
      calendars: [{ calendarId: 'c1', contributesToAvailability: true }],
    },
  }),
  useSetAvailabilityCalendarMutation: () => ({
    mutate: actions.busy,
    isPending: false,
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('writes display, account and countdown actions through existing controls', () => {
  render(() => <MobileCalendarSettingsPage onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Show weekends' }));
  expect(actions.weekends).toHaveBeenCalledWith(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Connect another account' })
  );
  expect(actions.connect).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
  expect(actions.account).toHaveBeenCalledWith(
    expect.objectContaining({ linkId: 'l1' })
  );
  fireEvent.click(
    screen.getByRole('switch', { name: 'Next meeting countdown' })
  );
  expect(actions.preference).toHaveBeenCalledWith(
    'showNextMeetingBadge',
    false
  );
});

it('pads every settings card row through the shared row', () => {
  render(() => <MobileCalendarSettingsPage onBack={vi.fn()} />);
  expect(
    screen
      .getAllByText('Show weekends')[0]
      .parentElement?.classList.contains('py-2')
  ).toBe(true);
  expect(
    screen.getByText('Week starts on').parentElement?.classList.contains('py-2')
  ).toBe(true);
  expect(
    screen
      .getByText('owner@example.com')
      .parentElement?.parentElement?.classList.contains('py-2')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Connect another account' })
      .parentElement?.classList.contains('py-2')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: /Busy calendars/ })
      .parentElement?.classList.contains('py-2')
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Busy calendars/ }));
  expect(
    screen
      .getByRole('checkbox', { name: 'Work' })
      .parentElement?.parentElement?.classList.contains('py-2')
  ).toBe(true);
});

it('edits busy calendars on the same page using the existing mutation', () => {
  render(() => <MobileCalendarSettingsPage onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Busy calendars/ }));
  expect(screen.getByRole('heading', { name: 'Busy calendars' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
  expect(actions.busy).toHaveBeenCalledWith(
    { userId: 'viewer', calendarIds: ['c1'], contributesToAvailability: false },
    expect.any(Object)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
  expect(
    screen.getByRole('heading', { name: 'Calendar settings' })
  ).toBeTruthy();
});

it('writes select values and availability through the existing settings owners', async () => {
  const availability = useAvailabilitySettings();
  render(() => <MobileCalendarSettingsPage onBack={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Week starts on / }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Monday' }));
  expect(actions.weekStart).toHaveBeenCalledWith(1);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Time format / }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('option', { name: '24-hour' }));
  expect(actions.timeFormat).toHaveBeenCalledWith('24-hour');
  fireEvent.keyDown(screen.getByRole('button', { name: /^Start time / }), {
    key: 'ArrowDown',
  });
  await screen.findByRole('option', { name: '10:00 AM' });
  expect(screen.queryByRole('option', { name: '11:30 PM' })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: '10:00 AM' }));
  expect(availability.settings().startTime).toBe('10:00');
  fireEvent.keyDown(screen.getByRole('button', { name: /^End time / }), {
    key: 'ArrowDown',
  });
  const endOptions = await screen.findAllByRole('option', { name: '6:00 PM' });
  fireEvent.click(endOptions[endOptions.length - 1]);
  expect(availability.settings().endTime).toBe('18:00');
  fireEvent.keyDown(
    screen.getByRole('button', { name: /^Share with teammates / }),
    { key: 'ArrowDown' }
  );
  fireEvent.click(await screen.findByRole('option', { name: 'Nothing' }));
  expect(actions.sharing).toHaveBeenCalledWith('none');
});
