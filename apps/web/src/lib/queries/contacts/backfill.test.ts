import { createClient, fetchExchange } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useSoupBackfills } from '../soup/backfill';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  hydrate: vi.fn(),
  flag: () => ({ enabled: true, loading: false }),
  leader: (): boolean => false,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
  getGraphqlSoupCacheHost: () => undefined,
  hydrateGraphqlSoup: mocks.hydrate,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
  enableGraphqlSoup: {},
}));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => mocks.leader(),
}));
vi.mock('../email/mail-accounts', () => ({ useMailAccountsQuery: vi.fn() }));

it('warms normal contacts independently of paged hydration, only for the signed-in backfill leader', async () => {
  const started = Promise.withResolvers<void>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    started.resolve();
    return new Response(
      JSON.stringify({
        data: {
          user: {
            id: 'macro|user@example.com',
            contacts: ['macro|contact@example.com'],
          },
        },
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );
  });
  mocks.client.mockReturnValue(
    createClient({
      url: 'https://contacts.invalid/graphql',
      fetch,
      exchanges: [fetchExchange],
    })
  );
  const [user, setUser] = createSignal<string>();
  const [leader, setLeader] = createSignal(false);
  const [flag, setFlag] = createSignal({ enabled: false, loading: false });
  mocks.leader = leader;
  mocks.flag = flag;
  let dispose!: () => void;
  createRoot((cleanup) => {
    dispose = cleanup;
    useSoupBackfills(user);
  });
  try {
    expect(fetch).not.toHaveBeenCalled();
    setUser('macro|user@example.com');
    setLeader(true);
    expect(fetch).not.toHaveBeenCalled();
    setFlag({ enabled: true, loading: false });
    await started.promise;
    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.hydrate).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
