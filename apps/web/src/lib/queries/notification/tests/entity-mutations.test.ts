import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateGraphqlNotificationsForEntities: vi.fn(async () => []),
}));

vi.mock('@service-storage/graphql-notifications', () => ({
  updateNotificationsForEntities: mocks.updateGraphqlNotificationsForEntities,
}));

vi.mock('@service-storage/graphql-soup', () => ({
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
});
