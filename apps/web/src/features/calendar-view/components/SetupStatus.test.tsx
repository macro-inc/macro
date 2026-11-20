/**
 * @vitest-environment jsdom
 */

import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startAddInbox: vi.fn() }));

const [userId, setUserId] = createSignal<string | undefined>('macro|self');
const [links, setLinks] = createSignal<EmailLink[]>([]);
const [calendars, setCalendars] = createSignal<
  { emailAddress: string; name: string; syncError?: string }[]
>([]);
const [teamEvents, setTeamEvents] = createSignal<{ id: string }[]>([]);

vi.mock('@app/features/calendar/components/CalendarPagerContext', () => ({
  useCalendarPager: () => ({
    activeData: () => ({
      range: () => undefined,
      occurrencesQuery: { isSuccess: true },
      events: () => [],
    }),
    activeTeamEvents: () => teamEvents(),
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

import { SetupBanner, SetupStatus } from './SetupStatus';

const CONNECT_DESCRIPTION =
  'Connect a Google or Microsoft account to show your calendar events.';
const GRANT_DESCRIPTION = 'Grant calendar access to show your events in Macro.';

// The calendar view puts the banner above the grid and the status over it.
function renderSetup() {
  render(() => (
    <>
      <div data-testid="above-grid">
        <SetupBanner />
      </div>
      <div data-testid="grid">
        <SetupStatus />
      </div>
    </>
  ));
  return {
    aboveGrid: () => within(screen.getByTestId('above-grid')),
    grid: () => within(screen.getByTestId('grid')),
  };
}

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
  setTeamEvents([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetupStatus', () => {
  it('asks a delegate with no inbox of their own to connect one', async () => {
    const user = userEvent.setup();
    setLinks([delegated('shared', { needs_calendar_permission: true })]);
    const view = renderSetup();

    expect(view.grid().getByText('Connect your calendar')).toBeTruthy();
    expect(view.grid().getByText(CONNECT_DESCRIPTION)).toBeTruthy();
    expect(view.aboveGrid().queryByRole('button')).toBeNull();
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
    const view = renderSetup();

    expect(view.aboveGrid().getByText('Connect your calendar')).toBeTruthy();
    expect(view.aboveGrid().getByText(CONNECT_DESCRIPTION)).toBeTruthy();
    expect(view.grid().queryByRole('button')).toBeNull();
    await user.click(
      view.aboveGrid().getByRole('button', { name: 'Connect calendar' })
    );

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
    const view = renderSetup();

    expect(
      view.aboveGrid().getByRole('button', { name: 'Grant access' })
    ).toBeTruthy();
    expect(view.grid().queryByText(GRANT_DESCRIPTION)).toBeNull();
  });

  it('offers setup above a teammate’s out-of-office instead of over it', async () => {
    const user = userEvent.setup();
    setLinks([link('own', { needs_calendar_permission: true })]);
    setTeamEvents([{ id: 'teammate-out-of-office' }]);
    const view = renderSetup();

    expect(view.aboveGrid().getByText('Enable calendar')).toBeTruthy();
    expect(view.aboveGrid().getByText(GRANT_DESCRIPTION)).toBeTruthy();
    expect(view.grid().queryByText('Enable calendar')).toBeNull();
    expect(view.grid().queryByRole('button')).toBeNull();
    await user.click(
      view.aboveGrid().getByRole('button', { name: 'Grant access' })
    );

    expect(mocks.startAddInbox).toHaveBeenCalledWith(
      expect.objectContaining({ reconnectLinkId: 'own', scopes: 'calendar' })
    );
  });

  it('explains missing setup over an empty grid instead of above it', () => {
    setLinks([link('own', { needs_calendar_permission: true })]);
    const view = renderSetup();

    expect(view.grid().getByText(GRANT_DESCRIPTION)).toBeTruthy();
    expect(
      view.grid().getByRole('button', { name: 'Grant access' })
    ).toBeTruthy();
    expect(view.aboveGrid().queryByRole('button')).toBeNull();
  });

  it('grants access for the viewer’s own inbox, not a delegated one needing reconnect', async () => {
    const user = userEvent.setup();
    setLinks([
      delegated('shared', { needs_reauth: true }),
      link('own', { needs_calendar_permission: true }),
    ]);
    renderSetup();

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
    renderSetup();

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
    const view = renderSetup();

    expect(
      view
        .aboveGrid()
        .getByText('Calendar for stopped@example.com stopped syncing')
    ).toBeTruthy();
    expect(
      view.aboveGrid().getByText('Reconnect to show its events in Macro again.')
    ).toBeTruthy();
    expect(view.grid().queryByRole('button')).toBeNull();
    await user.click(
      view.aboveGrid().getByRole('button', { name: 'Reconnect' })
    );

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
    renderSetup();

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
    renderSetup();

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a stopped calendar over an empty grid when it is the only one', () => {
    setLinks([
      link('stopped', {
        needs_calendar_permission: true,
        has_calendar_data: true,
      }),
    ]);
    renderSetup();

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
    renderSetup();

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('stays quiet when the viewer’s own calendar works, whatever a delegated inbox needs', () => {
    setLinks([
      link('own'),
      delegated('reauth', { needs_reauth: true }),
      delegated('permission', { needs_calendar_permission: true }),
    ]);
    renderSetup();

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits for the viewer’s id before deciding', () => {
    setUserId(undefined);
    setLinks([link('own', { needs_calendar_permission: true })]);
    renderSetup();
    expect(screen.queryByRole('button')).toBeNull();

    setUserId('macro|self');
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeTruthy();
  });
});
