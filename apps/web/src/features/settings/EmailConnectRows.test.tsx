/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailCard } from './Email';

const mocks = vi.hoisted(() => ({
  startAddInbox: vi.fn(async () => {}),
  providers: vi.fn(async () => ({ outlook: true })),
  failure: vi.fn(),
}));
const [connected, setConnected] = createSignal(false);
const [outlookOffered, setOutlookOffered] = createSignal(true);

vi.mock('@core/email-link', () => ({
  useEmailLinks: () => ({
    query: { isSuccess: true, data: { links: [] } },
    resyncInbox: vi.fn(),
  }),
  useEmailLinksStatus: () => connected,
  useAddInboxFlow: () => mocks.startAddInbox,
}));
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: mocks.providers,
  useOutlookAvailable: () => outlookOffered,
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_INBOX_RESYNC: false,
  ENABLE_INBOX_SYNC_STATUS: false,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure, success: vi.fn() },
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
vi.mock('./InboxSettingsOperations', () => ({
  InboxSettingsOperations: () => null,
}));
vi.mock('./SignatureSection', () => ({ clearSignatureState: vi.fn() }));

beforeEach(() => {
  setConnected(false);
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
