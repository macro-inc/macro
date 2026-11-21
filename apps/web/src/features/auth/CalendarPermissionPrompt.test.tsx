/**
 * @vitest-environment jsdom
 */

import { FakeToaster } from '@core/component/Toast/tests/fake-toast';
import type { Link as EmailLink } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startAddInbox: vi.fn() }));

const [userId, setUserId] = createSignal<string | undefined>('macro|self');
const [links, setLinks] = createSignal<EmailLink[]>([]);

vi.mock(
  '@core/component/Toast/Toast',
  () => import('@core/component/Toast/tests/fake-toast')
);

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

vi.mock('@core/context/user', () => ({ useUserId: () => userId }));

vi.mock('@core/email-link', () => ({
  useAddInboxFlow: () => mocks.startAddInbox,
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isSuccess: true,
    get data() {
      return { links: links() };
    },
  }),
}));

import { CalendarPermissionPrompt } from './CalendarPermissionPrompt';

const PERSIST_KEY = 'macro:calendar-prompt:dismissed';

const link = (id: string, overrides: Partial<EmailLink> = {}): EmailLink =>
  ({
    id,
    provider: 'GMAIL',
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    needs_calendar_permission: true,
    needs_reauth: false,
    calendar_disabled: false,
    has_calendar_data: false,
    is_primary: false,
    ...overrides,
  }) as unknown as EmailLink;

function renderPrompt() {
  render(() => (
    <>
      <FakeToaster />
      <CalendarPermissionPrompt />
    </>
  ));
}

beforeEach(() => {
  mocks.startAddInbox.mockResolvedValue(undefined);
  localStorage.clear();
  setUserId('macro|self');
  setLinks([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CalendarPermissionPrompt', () => {
  it('asks only for the viewer’s own inbox, never for one another user delegated', async () => {
    const user = userEvent.setup();
    setLinks([
      link('own'),
      link('delegated', { macro_id: 'macro|someone-else' }),
    ]);
    renderPrompt();

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(
      screen.getByText(
        'Macro can now sync your calendar. Grant calendar access for own@example.com to turn it on.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/delegated@example\.com/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(mocks.startAddInbox).toHaveBeenCalledWith({
      scopes: 'calendar',
      provider: 'GMAIL',
      reconnectLinkId: 'own',
      emailAddress: 'own@example.com',
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays quiet when the only inbox missing calendar is delegated', () => {
    setLinks([
      link('own', { needs_calendar_permission: false }),
      link('delegated', { macro_id: 'macro|someone-else' }),
    ]);
    renderPrompt();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tells an inbox whose calendar stopped syncing to reconnect, past an old Enable dismissal', async () => {
    const user = userEvent.setup();
    localStorage.setItem(PERSIST_KEY, JSON.stringify(['old']));
    setLinks([
      link('old', { has_calendar_data: true, is_sync_active: true }),
      link('new', { is_sync_active: true }),
    ]);
    renderPrompt();

    expect(screen.getByText('Calendar stopped syncing')).toBeTruthy();
    expect(
      screen.getByText(
        'Reconnect old@example.com to show its events in Macro again.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Enable calendar')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(mocks.startAddInbox).toHaveBeenCalledWith({
      scopes: 'calendar',
      provider: 'GMAIL',
      reconnectLinkId: 'old',
      emailAddress: 'old@example.com',
    });
  });

  it('keeps a closed prompt closed while the viewer is still loading', () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(['own']));
    setUserId(undefined);
    setLinks([link('own')]);
    renderPrompt();

    setUserId('macro|self');

    expect(screen.queryByRole('status')).toBeNull();
    expect(JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '[]')).toEqual([
      'own',
    ]);
  });
});
