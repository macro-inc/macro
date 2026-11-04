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
  useVisibleCalendarsQuery: () => ({ isSuccess: true, data: [] }),
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
