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

import {
  toNotificationEntityInput,
  toNotificationEntityRef,
  updateNotificationsForEntities,
} from '../entity-mutations';

describe('toNotificationEntityRef', () => {
  it('targets agent sessions so their notifications can be marked done', () => {
    const ref = toNotificationEntityRef({
      type: 'agent_session',
      id: 'session-1',
    });

    expect(ref).toEqual({ type: 'agent_session', id: 'session-1' });
    expect(toNotificationEntityInput(ref!)).toEqual({
      entityType: 'AGENT_SESSION',
      entityId: 'session-1',
    });
  });

  it('has no target for entity types the notification service does not file under', () => {
    expect(
      toNotificationEntityRef({ type: 'automation', id: 'automation-1' })
    ).toBeUndefined();
  });
});

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
