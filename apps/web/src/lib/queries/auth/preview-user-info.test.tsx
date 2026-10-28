import { UserContextProvider, useIsAuthenticated } from '@core/context/user';
import { hasLoginCookie } from '@core/util/cookies';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { Show } from 'solid-js';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  vi.stubGlobal('location', new URL('https://branch.preview.macro.com/app'));
  return {
    fetch: vi.fn(),
    startAccountServices: vi.fn(),
    client: undefined as QueryClient | undefined,
  };
});
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

// Exercise the real bootstrap gate, query and auth context together. Mocking
// the gate concealed the fresh-preview regression in the original change.
import { useUserInfoQuery } from './user-info';

function AccountServices() {
  mocks.startAccountServices();
  return <span>Account services active</span>;
}

function Identity() {
  const authenticated = useIsAuthenticated();
  const query = useUserInfoQuery();
  return (
    <>
      <span>{query.isError ? 'Signed out' : 'Checking identity'}</span>
      <Show when={authenticated() === true}>
        <AccountServices />
      </Show>
    </>
  );
}

function mountIdentity() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.client = client;
  render(() => (
    <QueryClientProvider client={client}>
      <UserContextProvider>
        <Identity />
      </UserContextProvider>
    </QueryClientProvider>
  ));
}

afterEach(() => {
  cleanup();
  mocks.client?.clear();
  vi.clearAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

it('discovers shared dev credentials without a preview marker and waits for confirmed identity', async () => {
  expect(hasLoginCookie()).toBe(false);
  const response = ok({ id: 'viewer', authenticated: true });
  const identity = Promise.withResolvers<typeof response>();
  mocks.fetch.mockReturnValue(identity.promise);
  mountIdentity();

  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.startAccountServices).not.toHaveBeenCalled();
  identity.resolve(response);
  expect(await screen.findByText('Account services active')).toBeTruthy();
  expect(mocks.startAccountServices).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it('keeps account services stopped when the preview has no valid dev credentials', async () => {
  mocks.fetch.mockResolvedValue(err([{ code: 'UNAUTHORIZED' }]));
  mountIdentity();

  expect(await screen.findByText('Signed out')).toBeTruthy();
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.startAccountServices).not.toHaveBeenCalled();
});
