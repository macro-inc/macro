/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImapMailboxSettings } from './ImapMailboxSettings';

const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({ userId: 'owner', session: 1 }),
  isCurrentQueryAccount: () => true,
  queryAccountSession: () => 1,
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    getImapMailboxSettings: api.read,
    updateImapMailboxSettings: api.update,
  },
}));

const snapshot = {
  revision: 3,
  features: {
    idle: true,
    uidPlus: true,
    smtpUtf8: true,
    sendLimitBytes: 5000000,
  },
  imap: {
    host: 'imap.example.net',
    port: 993,
    username: 'owner',
    tls: 'implicit',
  },
  smtp: {
    host: 'smtp.example.net',
    port: 587,
    username: 'sender',
    tls: 'start_tls',
  },
  folders: [
    {
      id: 'inbox',
      name: 'Inbox',
      monitored: true,
      detectedRole: 'inbox',
      effectiveRole: 'inbox',
      roleOverride: null,
      excluded: false,
      watched: false,
    },
    {
      id: 'review',
      name: 'Review',
      monitored: false,
      detectedRole: 'other',
      effectiveRole: 'other',
      roleOverride: null,
      excluded: false,
      watched: true,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  api.read.mockResolvedValue(ok(snapshot));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('keeps Inbox included and drops the extra watch when its folder is excluded', async () => {
  api.update.mockResolvedValue(ok(snapshot));
  render(() => (
    <ImapMailboxSettings
      linkId="owned"
      emailAddress="owner@example.net"
      onReconnect={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  const watched = await screen.findByLabelText(
    'Watch for new mail alongside Inbox'
  );
  expect(watched.textContent).toContain('Review');
  expect(screen.getByText('Outside the latest sync')).toBeTruthy();
  expect(screen.getByText('IDLE, UIDPLUS, SMTPUTF8')).toBeTruthy();
  expect(screen.getByText('5,000,000 bytes')).toBeTruthy();
  expect(screen.queryByLabelText('Sync Inbox')).toBeNull();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  fireEvent.keyDown(
    screen.getByRole('button', { name: /^Role for Review\b/ }),
    {
      key: 'ArrowDown',
    }
  );
  fireEvent.click(await screen.findByRole('option', { name: 'Archive' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sync Review' }));
  expect(watched.textContent).toContain('Inbox only');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(api.update).toHaveBeenCalledWith(
      'owned',
      {
        expectedRevision: 3,
        roleOverrides: { review: 'archive' },
        excludedFolderIds: ['review'],
        watchedFolderIds: [],
      },
      expect.any(AbortSignal),
      expect.anything()
    )
  );
});

it('reloads the settings version on conflict before a second edit', async () => {
  api.read
    .mockResolvedValueOnce(ok(snapshot))
    .mockResolvedValueOnce(ok({ ...snapshot, revision: 4 }));
  api.update
    .mockResolvedValueOnce(
      err([{ code: 'IMAP_CONNECTION_REFUSED', message: 'conflict' }])
    )
    .mockResolvedValueOnce(ok(snapshot));
  render(() => (
    <ImapMailboxSettings
      linkId="owned"
      emailAddress="owner@example.net"
      onReconnect={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  await screen.findByLabelText('Role for Review');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(api.update).toHaveBeenLastCalledWith(
      'owned',
      expect.objectContaining({ expectedRevision: 4 }),
      expect.any(AbortSignal),
      expect.anything()
    )
  );
});

it('lets the owner reconnect an existing inbox when saved settings cannot be read', async () => {
  api.read.mockResolvedValue(
    err([{ code: 'UNKNOWN', message: 'credentials_unavailable' }])
  );
  const reconnect = vi.fn();
  render(() => (
    <ImapMailboxSettings
      linkId="owned"
      emailAddress="owner@example.com"
      onReconnect={reconnect}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Change login details' }));
  expect(reconnect).toHaveBeenCalledTimes(1);
  expect(api.update).not.toHaveBeenCalled();
});

it('explains server Drafts without reporting an omitted sync folder', async () => {
  api.read.mockResolvedValue(
    ok({
      ...snapshot,
      folders: [
        snapshot.folders[0],
        {
          id: 'drafts',
          name: 'Drafts',
          monitored: false,
          detectedRole: 'drafts',
          effectiveRole: 'drafts',
          roleOverride: null,
          excluded: false,
          watched: false,
        },
      ],
    })
  );
  render(() => (
    <ImapMailboxSettings
      linkId="owned"
      emailAddress="owner@example.com"
      onReconnect={() => {}}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Server settings' }));
  await screen.findByText('Drafts');
  expect(
    screen.queryByText(/included folder.*outside the last sync/)
  ).toBeNull();
  expect(screen.queryByText('Outside the latest sync')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Sync Drafts' })).toBeNull();
  expect(
    screen.getByText('Server drafts are not synced to Macro.')
  ).toBeTruthy();
});
