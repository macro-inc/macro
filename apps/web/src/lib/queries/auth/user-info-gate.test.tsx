import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const [enabled, setEnabled] = createSignal(false);
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  client: undefined as QueryClient | undefined,
}));
vi.mock('@core/context/user-info-gate', () => ({
  shouldQueryUserInfo: () => enabled(),
  enableUserInfoQuery: () => setEnabled(true),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getLegacyUserPermissions: mocks.fetch },
}));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  syncPushRegistrations: vi.fn(),
}));
vi.mock('../client', () => ({
  get queryClient() {
    return mocks.client;
  },
  queryPersistence: { restoreQuery: vi.fn() },
}));

import { invalidateUserInfo, useUserInfoQuery } from './user-info';

afterEach(() => {
  cleanup();
  mocks.client?.clear();
  setEnabled(false);
  vi.clearAllMocks();
});

it('observes the anonymous session without fetching until login enables identity checks', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.client = client;
  mocks.fetch.mockResolvedValue(ok({ id: 'viewer', authenticated: true }));
  function Identity() {
    const query = useUserInfoQuery();
    return (
      <span>
        {query.isSuccess && query.data.authenticated
          ? 'Signed in'
          : 'Anonymous'}
      </span>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Identity />
    </QueryClientProvider>
  ));
  expect(screen.getByText('Anonymous')).toBeTruthy();
  expect(mocks.fetch).not.toHaveBeenCalled();

  await invalidateUserInfo();
  expect(await screen.findByText('Signed in')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
