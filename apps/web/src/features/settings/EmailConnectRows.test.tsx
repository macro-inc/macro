/** @vitest-environment jsdom */

import { formatLocale } from '@app/lib/i18n';
import type { Link } from '@service-email/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailCard } from './Email';

const mocks = vi.hoisted(() => ({
  startAddInbox: vi.fn(async () => {}),
  providers: vi.fn(async () => ({ outlook: true })),
  failure: vi.fn(),
  success: vi.fn(),
  alert: vi.fn(),
  resync: vi.fn(),
  links: [] as Link[],
}));
const [connected, setConnected] = createSignal(false);
const [outlookOffered, setOutlookOffered] = createSignal(true);

vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({
    query: {
      isSuccess: true,
      get data() {
        return { links: mocks.links };
      },
    },
    resyncInbox: mocks.resync,
  }),
  useEmailLinksStatus: () => connected,
  useAddInboxFlow: () => mocks.startAddInbox,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: mocks.providers,
  useOutlookAvailable: () => outlookOffered,
  useImapAvailable: () => () => false,
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_INBOX_RESYNC: true,
  ENABLE_INBOX_SYNC_STATUS: false,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure, success: mocks.success, alert: mocks.alert },
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => undefined,
  useUserId: () => () => 'me',
}));
vi.mock('@queries/email/link', () => ({
  useRemoveInboxMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@app/features/calendar/components/TurnOffCalendarDialog', () => ({
  TurnOffCalendarDialog: () => null,
}));
vi.mock('./ImapMailboxSettings', () => ({ ImapMailboxSettings: () => null }));
vi.mock('./InboxSettingsOperations', () => ({
  InboxSettingsOperations: () => null,
}));
vi.mock('./SignatureSection', () => ({ clearSignatureState: vi.fn() }));

beforeEach(() => {
  setConnected(false);
  mocks.resync.mockImplementation(() =>
    okAsync({
      backfill_job_id: 'run',
      already_in_progress: false,
      provider_retry_at: null,
    })
  );
  mocks.links = [];
  setOutlookOffered(true);
  mocks.providers.mockResolvedValue({ outlook: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('connects the chosen provider without asking again', async () => {
  render(() => <EmailCard />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Connect a Google Workspace account' })
  );
  await vi.waitFor(() =>
    expect(mocks.startAddInbox).toHaveBeenCalledWith({ provider: 'GMAIL' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Connect an Outlook account' })
  );
  await vi.waitFor(() =>
    expect(mocks.startAddInbox).toHaveBeenCalledWith({ provider: 'OUTLOOK' })
  );
});

it('stops before consent when Outlook closed after the row was shown', async () => {
  mocks.providers.mockResolvedValue({ outlook: false });
  render(() => <EmailCard />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Connect an Outlook account' })
  );
  await vi.waitFor(() => expect(mocks.failure).toHaveBeenCalled());
  expect(mocks.startAddInbox).not.toHaveBeenCalled();
});

it('offers another account once an inbox is connected', () => {
  setConnected(true);
  render(() => <EmailCard />);
  expect(
    screen.getByRole('button', { name: 'Connect an Outlook account' })
  ).toBeTruthy();
});

it.each([
  {
    issue: 'credentials_unreadable',
    needsReauth: true,
    expected: "Macro can't read this mailbox's saved password",
  },
  {
    issue: 'snapshot_too_large',
    needsReauth: false,
    expected: 'Mailbox too large to sync yet',
  },
] satisfies {
  issue: Link['mailbox_issue'];
  needsReauth: boolean;
  expected: string;
}[])(
  'renders specific $issue guidance for the connected inbox',
  ({ issue, needsReauth, expected }) => {
    setConnected(true);
    mocks.links = [
      {
        id: 'synthetic-link',
        macro_id: 'me',
        email_address: 'user@example.com',
        fusionauth_user_id: 'synthetic-user',
        provider: 'IMAP',
        is_primary: true,
        is_sync_active: true,
        needs_reauth: needsReauth,
        mailbox_issue: issue,
        needs_calendar_permission: true,
        calendar_disabled: false,
        has_calendar_data: false,
        sync_status: 'ERROR',
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];
    render(() => <EmailCard />);
    expect(screen.getByText(expected, { exact: false })).toBeTruthy();
    expect(
      screen.queryByText(
        'Mailbox sync needs attention. Open server settings for details.'
      )
    ).toBeNull();
  }
);

it('shows the provider pause deadline instead of claiming a resync started', async () => {
  const until = '2099-01-02T03:04:00Z';
  setConnected(true);
  mocks.links = [
    {
      id: 'synthetic-link',
      macro_id: 'me',
      email_address: 'user@example.com',
      fusionauth_user_id: 'synthetic-user',
      provider: 'IMAP',
      is_primary: true,
      is_sync_active: true,
      needs_reauth: false,
      needs_calendar_permission: true,
      calendar_disabled: false,
      has_calendar_data: false,
      sync_status: 'UP_TO_DATE',
      settings: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];
  mocks.resync.mockImplementation(() =>
    okAsync({
      backfill_job_id: 'run',
      already_in_progress: false,
      provider_retry_at: until,
    })
  );
  render(() => <EmailCard />);
  fireEvent.click(
    screen.getByRole('button', {
      name: /^Force sync user@example\.com$/,
    })
  );
  await vi.waitFor(() =>
    expect(mocks.alert).toHaveBeenCalledWith(
      `Paused by your provider until ${new Date(until).toLocaleString(formatLocale())}`
    )
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
