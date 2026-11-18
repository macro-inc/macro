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
      toNotificationEntityRef({ type: 'routine', id: 'routine-1' })
    ).toBeUndefined();
  });
});

describe('updateNotificationsForEntities', () => {
  beforeEach(() => {
    mocks.cacheEnabled = true;
    vi.clearAllMocks();
  });

  it.each(['MARK_SEEN', 'MARK_DONE'] as const)(
    'sends %s for modern projects without targeting legacy folders',
    async (operation) => {
      const initiative = toNotificationEntityRef({
        type: 'initiative',
        id: 'project-1',
      });
      const folder = toNotificationEntityRef({
        type: 'project',
        id: 'project-1',
      });
      if (!initiative || !folder) {
        throw new Error('Both project types must support notification writes');
      }

      await updateNotificationsForEntities({
        entities: [initiative, folder],
        operation,
        expectedNotificationIds: ['notification-1'],
      });

      expect(
        mocks.updateGraphqlNotificationsForEntities
      ).toHaveBeenCalledExactlyOnceWith({
        entities: [
          { entityType: 'INITIATIVE', entityId: 'project-1' },
          { entityType: 'PROJECT', entityId: 'project-1' },
        ],
        operation,
        expectedNotificationIds: ['notification-1'],
      });
    }
  );

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
