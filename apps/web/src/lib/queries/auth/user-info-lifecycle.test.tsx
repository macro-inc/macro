import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserInfo: vi.fn(),
  client: undefined as QueryClient | undefined,
}));
vi.mock('../client', () => ({
  get queryClient() {
    return mocks.client;
  },
  queryPersistence: { restoreQuery: vi.fn() },
}));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  syncPushRegistrations: vi.fn(),
}));
vi.mock('@core/context/user-info-gate', () => ({
  enableUserInfoQuery: vi.fn(),
}));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => true }));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getLegacyUserPermissions: mocks.getUserInfo },
}));

import { invalidateAllAfterLogin, useUserInfoQuery } from './user-info';

afterEach(() => {
  cleanup();
  mocks.client?.clear();
  vi.clearAllMocks();
});

it('keeps signed-out onboarding mounted when it observes the session, then refreshes after login', async () => {
  mocks.getUserInfo.mockResolvedValue(
    err([{ code: 'UNAUTHORIZED', message: 'Not signed in' }])
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.client = client;
  const [showOnboarding, setShowOnboarding] = createSignal(false);
  const loadingStates: boolean[] = [];
  const unsubscribe = client.getQueryCache().subscribe(() => {
    loadingStates.push(client.isFetching() > 0);
  });

  function Onboarding() {
    useUserInfoQuery();
    return <h1>Make Macro yours</h1>;
  }
  function AuthGate() {
    const session = useUserInfoQuery();
    return (
      <Show when={!session.isLoading} fallback={<p>Loading session</p>}>
        <Show
          when={session.isSuccess}
          fallback={
            <Show when={showOnboarding()}>
              <Onboarding />
            </Show>
          }
        >
          <p>Signed in</p>
        </Show>
      </Show>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <AuthGate />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(mocks.getUserInfo).toHaveBeenCalledOnce();

  loadingStates.length = 0;
  setShowOnboarding(true);
  await screen.findByRole('heading', { name: 'Make Macro yours' });
  expect(loadingStates).not.toContain(true);
  expect(mocks.getUserInfo).toHaveBeenCalledOnce();

  mocks.getUserInfo.mockResolvedValue(
    ok({ authenticated: true, userId: 'viewer', tutorialComplete: false })
  );
  await invalidateAllAfterLogin();
  await screen.findByText('Signed in');
  expect(mocks.getUserInfo).toHaveBeenCalledTimes(2);
  unsubscribe();
});
