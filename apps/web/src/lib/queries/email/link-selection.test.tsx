import type { Link, ListLinksResponse } from '@service-email/generated/schemas';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useEmailSignature,
  useNonPrimaryEmailLinkIdHeader,
  usePrimaryEmailLinkId,
} from './link';

const mocks = vi.hoisted(() => ({ getLinks: vi.fn() }));
vi.mock('@service-email/client', () => ({
  emailClient: { getLinks: mocks.getLinks },
}));
vi.mock('@queries/calendar/sync', () => ({ invalidateCalendarViews: vi.fn() }));
vi.mock('@queries/auth/user-info', () => ({ invalidateUserInfo: vi.fn() }));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|self' }));
vi.mock('@queries/client', () => ({ queryClient: {} }));

const link = (id: string, owner: string, primary: boolean): Link => ({
  id,
  macro_id: owner,
  is_primary: primary,
  email_address: `${id}@example.com`,
  calendar_disabled: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  fusionauth_user_id: owner,
  has_calendar_data: false,
  is_sync_active: true,
  needs_calendar_permission: false,
  needs_reauth: false,
  provider: 'GMAIL',
  sync_status: 'UP_TO_DATE',
  settings: { signature: `<p>${id} signature</p>` },
});

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.clearAllMocks();
});

describe('non-suspending inbox metadata', () => {
  it('does not hold a cached body for inbox metadata or silently default an explicit target inbox', async () => {
    const response = Promise.withResolvers<ListLinksResponse>();
    mocks.getLinks.mockImplementation(async () => ok(await response.promise));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const [target, setTarget] = createSignal('shared');
    function View() {
      const primary = usePrimaryEmailLinkId();
      const header = useNonPrimaryEmailLinkIdHeader();
      const signature = useEmailSignature(target);
      return (
        <div data-testid="body">
          <span data-testid="primary">{primary() ?? 'unknown'}</span>
          <span data-testid="header">{header(target()) ?? 'default'}</span>
          <span data-testid="signature">{signature() ?? 'unknown'}</span>
        </div>
      );
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<div data-testid="loading" />}>
          <View />
        </Suspense>
      </QueryClientProvider>
    ));
    expect(screen.getByTestId('body')).toBeTruthy();
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.getByTestId('primary').textContent).toBe('unknown');
    expect(screen.getByTestId('header').textContent).toBe('shared');
    expect(screen.getByTestId('signature').textContent).toBe('unknown');
    setTarget('self-primary');
    expect(screen.getByTestId('header').textContent).toBe('self-primary');

    response.resolve({
      links: [
        link('delegated-primary', 'macro|other', true),
        link('self-primary', 'macro|self', true),
        link('shared', 'macro|self', false),
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId('primary').textContent).toBe('self-primary')
    );
    expect(screen.getByTestId('header').textContent).toBe('default');
    expect(screen.getByTestId('signature').textContent).toBe(
      '<p>self-primary signature</p>'
    );
    setTarget('shared');
    expect(screen.getByTestId('header').textContent).toBe('shared');
    expect(screen.getByTestId('signature').textContent).toBe(
      '<p>shared signature</p>'
    );
  });
});
