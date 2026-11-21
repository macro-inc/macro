import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok, ResultAsync } from 'neverthrow';
import { batch, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from '../auth/keys';
import { useSetAgentAvatarMutation } from './avatar';
import { useCreateTeamAgentMutation } from './team-agents';

const api = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
const [viewer, setViewer] = createSignal('macro|one@example.com');
let client: QueryClient;
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => viewer,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@core/constant/featureFlags', async (original) => ({
  ...(await original<typeof import('@core/constant/featureFlags')>()),
  ENABLE_BEARER_TOKEN_AUTH: false,
}));
vi.mock('@core/util/safeFetch', async (original) => ({
  ...(await original<typeof import('@core/util/safeFetch')>()),
  safeFetch: api.request,
}));
vi.mock('@core/auth/session-refresh', () => ({
  fetchToken: api.refresh,
  resetMacroApiToken: vi.fn(),
  confirmSessionExpired: vi.fn(),
  ensureFreshSession: vi.fn(),
  unsetTokenPromise: vi.fn(),
}));
vi.mock('@core/signal/profilePicture', () => ({
  refreshProfilePicture: vi.fn(),
}));
vi.mock('../auth', () => ({ invalidateAiBillingSummary: vi.fn() }));
vi.mock('../team/teams', () => ({ invalidateTeam: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  setViewer('macro|one@example.com');
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

for (const action of ['create', 'avatar'] as const) {
  it(`aborts ${action} during token refresh when the account changes, without replaying`, async () => {
    const refreshing = Promise.withResolvers<void>();
    const refresh = Promise.withResolvers<ReturnType<typeof ok<void>>>();
    api.request.mockResolvedValue(
      err([{ code: 'UNAUTHORIZED', message: 'Unauthorized' }])
    );
    api.refresh.mockImplementationOnce(() => {
      refreshing.resolve();
      return refresh.promise;
    });
    const ready = Promise.withResolvers<() => Promise<unknown>>();
    function Harness() {
      const create = useCreateTeamAgentMutation();
      const avatar = useSetAgentAvatarMutation();
      ready.resolve(() =>
        action === 'create'
          ? create.mutateAsync({
              teamId: 'team-1',
              request: {
                name: 'Ada',
                size: 'standard',
                purchaseKey: 'example',
              },
            })
          : avatar.mutateAsync({
              userId: 'macro|agent@example.com',
              avatar: { face: null, url: 'https://example.com/photo.png' },
            })
      );
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    const run = await ready.promise;
    const result = ResultAsync.fromPromise(run(), (error) => error);
    await refreshing.promise;
    const signal: AbortSignal | undefined =
      api.request.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    batch(() => {
      client.setQueryData(authKeys.userInfo.queryKey, {
        id: 'macro|two@example.com',
        authenticated: true,
      });
      setViewer('macro|two@example.com');
    });
    expect(signal?.aborted).toBe(true);
    refresh.resolve(ok(undefined));
    expect((await result).isErr()).toBe(true);
    expect(api.request).toHaveBeenCalledTimes(1);
  });
}
