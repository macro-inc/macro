import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startAddInbox: vi.fn(),
  links: [] as unknown[],
  sources: [] as unknown[],
  availability: [] as unknown[],
  setAvailability: vi.fn(),
}));

vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => mocks.startAddInbox,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: { links: mocks.links },
    refetch: vi.fn(),
  }),
  useDisableCalendarMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@queries/calendar/availability', () => ({
  useAvailabilityCalendarsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { calendars: mocks.availability },
    refetch: vi.fn(),
  }),
  useSetAvailabilityCalendarMutation: () => ({
    mutate: mocks.setAvailability,
  }),
}));
vi.mock('./hooks/use-calendar-sources', () => ({
  useCalendarSources: () => ({
    sources: () => mocks.sources,
    calendarsQuery: {
      isSuccess: true,
      isPending: false,
      isError: false,
      data: [],
      refetch: vi.fn(),
    },
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));

import { CalendarConnectionSettings } from './calendar-settings';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startAddInbox.mockResolvedValue(undefined);
  mocks.sources = [];
  mocks.availability = [];
});
afterEach(cleanup);

it('re-consents the Outlook account whose Connect calendar was clicked', () => {
  mocks.links = [
    {
      id: 'gmail-link',
      macro_id: 'macro|self',
      email_address: 'teo@macro.com',
      provider: 'GMAIL',
      needs_calendar_permission: false,
      needs_reauth: false,
    },
    {
      id: 'outlook-link',
      macro_id: 'macro|self',
      email_address: 'teo@contoso.onmicrosoft.com',
      provider: 'OUTLOOK',
      needs_calendar_permission: true,
      needs_reauth: false,
    },
  ];
  render(() => <CalendarConnectionSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect calendar' }));
  expect(mocks.startAddInbox).toHaveBeenCalledExactlyOnceWith({
    scopes: 'calendar',
    provider: 'OUTLOOK',
    reconnectLinkId: 'outlook-link',
    emailAddress: 'teo@contoso.onmicrosoft.com',
  });
});

it('re-consents a lone Gmail account, restoring mail access it lost', () => {
  mocks.links = [
    {
      id: 'gmail-link',
      macro_id: 'macro|self',
      email_address: 'teo@macro.com',
      provider: 'GMAIL',
      needs_calendar_permission: true,
      needs_reauth: true,
    },
  ];
  render(() => <CalendarConnectionSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(mocks.startAddInbox).toHaveBeenCalledExactlyOnceWith({
    scopes: 'gmail_and_calendar',
    provider: 'GMAIL',
    reconnectLinkId: 'gmail-link',
    emailAddress: 'teo@macro.com',
  });
});

it('asks for a provider when connecting another account', () => {
  mocks.links = [
    {
      id: 'outlook-link',
      macro_id: 'macro|self',
      email_address: 'teo@contoso.onmicrosoft.com',
      provider: 'OUTLOOK',
      needs_calendar_permission: false,
      needs_reauth: false,
    },
  ];
  render(() => <CalendarConnectionSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect account' }));
  expect(mocks.startAddInbox).toHaveBeenCalledExactlyOnceWith({
    scopes: 'gmail_and_calendar',
  });
});

it("saves a calendar's Busy switch to the viewer's availability setting", () => {
  mocks.links = [
    {
      id: 'gmail-link',
      macro_id: 'macro|self',
      email_address: 'teo@macro.com',
      provider: 'GMAIL',
      needs_calendar_permission: false,
      needs_reauth: false,
    },
  ];
  mocks.sources = [
    {
      id: 'coworker',
      name: 'Coworker',
      color: '#654321',
      emailLinkId: 'gmail-link',
      emailAddress: 'teo@macro.com',
    },
  ];
  mocks.availability = [
    {
      calendarId: 'coworker',
      name: 'Coworker',
      isPrimary: false,
      contributesToAvailability: true,
    },
  ];
  render(() => <CalendarConnectionSettings />);
  fireEvent.click(
    screen.getByRole('switch', { name: 'Coworker counts as busy' })
  );
  expect(mocks.setAvailability).toHaveBeenCalledExactlyOnceWith(
    {
      userId: 'macro|self',
      calendarIds: ['coworker'],
      contributesToAvailability: false,
    },
    expect.anything()
  );
});
