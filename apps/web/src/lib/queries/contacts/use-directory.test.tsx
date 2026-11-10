import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contactRecordKey } from './contact-key';
import { usePinnedContactUsers } from './use-directory';

const VIEWER = 'macro|viewer@example.com';
const fetchIds = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
  fetchContactDirectoryByIds: fetchIds,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => undefined,
}));
vi.mock('@queries/auth/use-query-account', () => ({
  useQueryAccount: () => () => ({
    userId: 'macro|viewer@example.com',
    session: 0,
  }),
}));
vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
beforeEach(() => {
  fetchIds.mockReset().mockImplementation(async (ids: string[]) => ({
    user: {
      id: VIEWER,
      contactsByUserIds: ids.map((userId) => ({
        id: contactRecordKey(VIEWER, userId).slice('GraphqlContact:'.length),
        userId,
        email: userId.slice('macro|'.length),
        name: 'Person',
      })),
    },
  }));
});
afterEach(cleanup);

it.each([0, 499, 500])(
  'resolves all %i selections plus self without overflowing a raw lookup batch',
  async (count) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const selected = Array.from(
      { length: count },
      (_, index) => `macro|person${index}@example.com`
    );
    const loaded = Promise.withResolvers<string[]>();
    function Harness() {
      const users = usePinnedContactUsers(
        () => selected,
        () => true
      );
      createEffect(() => {
        if (users().length === count + 1)
          loaded.resolve(users().map((user) => user.id));
      });
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    expect(await loaded.promise).toEqual([...selected, VIEWER]);
    expect(
      fetchIds.mock.calls.map(([ids]) => ids.length).sort((a, b) => a - b)
    ).toEqual(count === 500 ? [1, 500] : [count + 1]);
    expect(selected).toHaveLength(count);
    client.clear();
  }
);
