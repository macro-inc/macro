/**
 * @vitest-environment jsdom
 */

import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startAddInbox: vi.fn() }));

const [userId, setUserId] = createSignal<string | undefined>('macro|self');
const [links, setLinks] = createSignal<EmailLink[]>([]);
const [calendars, setCalendars] = createSignal<
  { emailAddress: string; name: string; syncError?: string }[]
>([]);

vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({
    activeData: () => ({
      range: () => undefined,
      occurrencesQuery: { isSuccess: true },
      events: () => [],
    }),
    activeTeamEvents: () => [],
  }),
}));

vi.mock('@core/context/user', () => ({ useUserId: () => userId }));

vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => mocks.startAddInbox,
}));

vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({
    isSuccess: true,
    get data() {
      return calendars();
    },
  }),
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isSuccess: true,
    get data() {
      return { links: links() };
    },
  }),
}));

import { SetupStatus } from './SetupStatus';

// Only the overlay over an empty grid explains itself; the pill is title and
// action alone.
const CONNECT_DESCRIPTION =
  'Connect a Google or Microsoft account to show your calendar events.';

const link = (id: string, overrides: Partial<EmailLink> = {}): EmailLink =>
  ({
    id,
    provider: 'GMAIL',
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    is_sync_active: true,
    needs_calendar_permission: false,
    needs_reauth: false,
    calendar_disabled: false,
    ...overrides,
  }) as unknown as EmailLink;

const delegated = (id: string, overrides: Partial<EmailLink> = {}) =>
  link(id, { macro_id: 'macro|someone-else', ...overrides });

beforeEach(() => {
  mocks.startAddInbox.mockResolvedValue(undefined);
  setUserId('macro|self');
  setLinks([]);
  setCalendars([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetupStatus', () => {
  it('asks a delegate with no inbox of their own to connect one', async () => {
    const user = userEvent.setup();
    setLinks([delegated('shared', { needs_calendar_permission: true })]);
    render(() => <SetupStatus />);

    expect(screen.getByText('Connect your calendar')).toBeTruthy();
    expect(screen.getByText(CONNECT_DESCRIPTION)).toBeTruthy();
    expect(screen.queryByText('Enable calendar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect calendar' }));

    expect(mocks.startAddInbox).toHaveBeenCalledWith({
      provider: undefined,
      reconnectLinkId: undefined,
      emailAddress: undefined,
      scopes: 'gmail_and_calendar',
    });
  });

  it('offers a delegate whose shared calendar works their own without covering the grid', async () => {
    const user = userEvent.setup();
    setLinks([delegated('shared')]);
    render(() => <SetupStatus />);

    expect(screen.getByText('Connect your calendar')).toBeTruthy();
    expect(screen.queryByText(CONNECT_DESCRIPTION)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect calendar' }));

    expect(mocks.startAddInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        reconnectLinkId: undefined,
        scopes: 'gmail_and_calendar',
      })
    );
  });

  it('keeps an own inbox’s fix out of the way while a shared calendar works', () => {
    setLinks([
      delegated('shared'),
      link('own', { needs_calendar_permission: true }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.getByRole('button', { name: 'Grant access' })).toBeTruthy();
    expect(
      screen.queryByText('Grant calendar access to show your events in Macro.')
    ).toBeNull();
  });

  it('grants access for the viewer’s own inbox, not a delegated one needing reconnect', async () => {
    const user = userEvent.setup();
    setLinks([
      delegated('shared', { needs_reauth: true }),
      link('own', { needs_calendar_permission: true }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.getByText('Enable calendar')).toBeTruthy();
    expect(screen.queryByText('Reconnect calendar')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Grant access' }));

    expect(mocks.startAddInbox).toHaveBeenCalledWith({
      provider: 'GMAIL',
      reconnectLinkId: 'own',
      emailAddress: 'own@example.com',
      scopes: 'calendar',
    });
  });

  it('says calendar is off from the viewer’s own inboxes alone', async () => {
    const user = userEvent.setup();
    setLinks([
      delegated('shared', { needs_calendar_permission: true }),
      link('own', { needs_calendar_permission: true, calendar_disabled: true }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.getByText('Calendar is off')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(mocks.startAddInbox).toHaveBeenCalledWith(
      expect.objectContaining({ reconnectLinkId: 'own', scopes: 'calendar' })
    );
  });

  it('names an inbox whose calendar stopped syncing while another inbox works', async () => {
    const user = userEvent.setup();
    setLinks([
      link('working'),
      link('stopped', {
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    render(() => <SetupStatus />);

    const title = screen.getByText(
      'Calendar for stopped@example.com stopped syncing'
    );
    // The app-wide prompt for the same inbox opens in the bottom-right toast
    // stack; the pill rides above it instead of hiding under it.
    expect(title.parentElement?.className).toContain(
      'var(--desktop-toast-inset-bottom'
    );
    expect(
      screen.queryByText('Reconnect to show its events in Macro again.')
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(mocks.startAddInbox).toHaveBeenCalledWith({
      provider: 'GMAIL',
      reconnectLinkId: 'stopped',
      emailAddress: 'stopped@example.com',
      scopes: 'calendar',
    });
  });

  it('keeps a working calendar’s sync error in view beside a stopped one', () => {
    setLinks([
      link('working'),
      link('stopped', {
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    setCalendars([
      {
        emailAddress: 'working@example.com',
        name: 'Team',
        syncError: 'Google rejected the request',
      },
    ]);
    render(() => <SetupStatus />);

    expect(
      screen.getByText('Calendar for stopped@example.com stopped syncing')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'working@example.com — Team: Google rejected the request'
      )
    ).toBeTruthy();
  });

  it('leaves a disconnected inbox’s old calendar alone', () => {
    setLinks([
      link('working'),
      link('gone', {
        is_sync_active: false,
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a stopped calendar over an empty grid when it is the only one', () => {
    setLinks([
      link('stopped', {
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    render(() => <SetupStatus />);

    expect(
      screen.getByText('Calendar for stopped@example.com stopped syncing')
    ).toBeTruthy();
    expect(
      screen.getByText('Reconnect to show its events in Macro again.')
    ).toBeTruthy();
  });

  it('leaves a calendar that was never enabled, or a delegated stopped one, to settings while another works', () => {
    setLinks([
      link('working'),
      link('never', { needs_calendar_permission: true }),
      delegated('theirs', {
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays quiet when the viewer’s own calendar works, whatever a delegated inbox needs', () => {
    setLinks([
      link('own'),
      delegated('reauth', { needs_reauth: true }),
      delegated('permission', { needs_calendar_permission: true }),
    ]);
    render(() => <SetupStatus />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits for the viewer’s id before deciding', () => {
    setUserId(undefined);
    setLinks([link('own', { needs_calendar_permission: true })]);
    render(() => <SetupStatus />);
    expect(screen.queryByRole('button')).toBeNull();

    setUserId('macro|self');
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeTruthy();
  });
});
