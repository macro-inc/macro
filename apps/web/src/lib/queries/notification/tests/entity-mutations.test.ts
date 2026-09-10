import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheEnabled: true,
  refreshActiveGraphqlSoupQueries: vi.fn(async () => undefined),
  updateGraphqlNotificationsForEntities: vi.fn(async () => []),
}));

vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refreshActiveGraphqlSoupQueries,
}));

vi.mock('@service-storage/graphql-notifications', () => ({
  updateNotificationsForEntities: mocks.updateGraphqlNotificationsForEntities,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => mocks.cacheEnabled,
  mapGraphqlNotification: vi.fn((notification) => notification),
}));

import { updateNotificationsForEntities } from '../entity-mutations';

describe('updateNotificationsForEntities', () => {
  beforeEach(() => {
    mocks.cacheEnabled = true;
    vi.clearAllMocks();
  });

  it('relies on normalized cache updates when the cache is active', async () => {
    await updateNotificationsForEntities({
      entities: [{ type: 'channel', id: 'channel-1' }],
      operation: 'MARK_SEEN',
    });

    expect(mocks.refreshActiveGraphqlSoupQueries).not.toHaveBeenCalled();
  });

  it('refreshes active Soup queries after an uncached write', async () => {
    mocks.cacheEnabled = false;

    await updateNotificationsForEntities({
      entities: [{ type: 'channel', id: 'channel-1' }],
      operation: 'MARK_SEEN',
    });

    expect(mocks.refreshActiveGraphqlSoupQueries).toHaveBeenCalledOnce();
  });
});
