/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCalendarFirstSync } from '../first-sync';

const mocks = vi.hoisted(() => ({
  listOccurrences: vi.fn(),
  links: [] as {
    id: string;
    is_sync_active: boolean;
    needs_reauth: boolean;
    needs_calendar_permission: boolean;
  }[],
  calendars: [] as { emailLinkId: string; isWritable: boolean }[],
}));

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    isPending: false,
    data: { links: mocks.links },
  }),
}));
vi.mock('../calendars', () => ({
  useVisibleCalendarsQuery: () => ({ isPending: false, data: mocks.calendars }),
}));
vi.mock('../../auth/use-query-account', () => ({
  useQueryAccount: () => () => ({ userId: 'viewer', session: 1 }),
}));
vi.mock('../../auth/account-scope', () => ({ assertQueryAccount: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarOccurrences: mocks.listOccurrences },
}));

const connectedLink = {
  id: 'connected',
  is_sync_active: true,
  needs_reauth: false,
  needs_calendar_permission: false,
};

function Probe() {
  const syncing = useCalendarFirstSync(() => true);
  return <output>{syncing() ? 'Syncing' : 'Idle'}</output>;
}

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.links = [connectedLink];
  mocks.calendars = [];
  mocks.listOccurrences
    .mockReset()
    .mockResolvedValue(ok({ syncStatus: 'syncing' }));
});
afterEach(() => {
  cleanup();
  client.clear();
});

function openProbe() {
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
}

it('checks ingestion only while a connected inbox has no discovered calendar', async () => {
  openProbe();

  await screen.findByText('Syncing');
  expect(mocks.listOccurrences).toHaveBeenCalledOnce();
  expect(mocks.listOccurrences).toHaveBeenCalledWith(
    expect.objectContaining({ limit: 1 })
  );
});

it('does not wait for a settled read-only inbox', () => {
  mocks.calendars = [{ emailLinkId: connectedLink.id, isWritable: false }];
  openProbe();

  expect(screen.getByText('Idle')).toBeTruthy();
  expect(mocks.listOccurrences).not.toHaveBeenCalled();
});

it('does not wait for an inbox that needs calendar access', () => {
  mocks.links = [{ ...connectedLink, needs_calendar_permission: true }];
  openProbe();

  expect(screen.getByText('Idle')).toBeTruthy();
  expect(mocks.listOccurrences).not.toHaveBeenCalled();
});
