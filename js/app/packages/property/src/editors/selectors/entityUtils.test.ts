import type { EntityData } from '@entity';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

// Mock @core/context/quickAccess to break the import chain that pulls in
// LexicalMarkdown plugins -> themeSignals -> window.matchMedia
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => () => [],
    isLoading: () => false,
    refresh: () => {},
    getById: () => undefined,
  }),
  ALL_BUCKETS: [],
  isEntityItem: () => false,
  isUserItem: () => false,
  isEntityOfType: () => false,
  isFromBucket: () => false,
  exclude: () => () => true,
}));

import type { IUser } from '@core/user';
import type { CombinedEntity } from './entityUtils';
import {
  createEntitySearchConfig,
  sortEntitiesWithSelfFirst,
} from './entityUtils';

describe('createEntitySearchConfig', () => {
  it('should return correct search config with same weights as MentionsMenu', () => {
    const [domain] = createSignal('example.com');
    const config = createEntitySearchConfig(domain);

    expect(config.fuzzyWeight).toBe(0.5);
    expect(config.timeWeight).toBe(0.4);
    expect(config.brevityWeight).toBe(0.1);
    expect(config.boostFn).toBeDefined();
  });

  it('should boost users with same domain', () => {
    const [domain] = createSignal('example.com');
    const config = createEntitySearchConfig(domain);

    const userEntity: CombinedEntity = {
      kind: 'user',
      id: 'user-1',
      data: {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
      } as IUser,
    };

    const boost = config.boostFn!(userEntity);
    expect(boost).toBe(0.5);
  });

  it('should not boost users with different domain', () => {
    const [domain] = createSignal('example.com');
    const config = createEntitySearchConfig(domain);

    const userEntity: CombinedEntity = {
      kind: 'user',
      id: 'user-1',
      data: {
        id: 'user-1',
        email: 'test@other.com',
        name: 'Test User',
      } as IUser,
    };

    const boost = config.boostFn!(userEntity);
    expect(boost).toBe(0);
  });

  it('should not boost non-user entities', () => {
    const [domain] = createSignal('example.com');
    const config = createEntitySearchConfig(domain);

    const channelEntity: CombinedEntity = {
      kind: 'entity',
      id: 'channel-1',
      data: {
        type: 'channel',
        id: 'channel-1',
        name: 'Test Channel',
        ownerId: 'owner-1',
        channelType: 'public',
      },
    };

    const boost = config.boostFn!(channelEntity);
    expect(boost).toBe(0);
  });

  it('should be reactive to domain changes', () => {
    const [domain, setDomain] = createSignal('example.com');
    const config = createEntitySearchConfig(domain);

    const userEntity: CombinedEntity = {
      kind: 'user',
      id: 'user-1',
      data: {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
      } as IUser,
    };

    expect(config.boostFn!(userEntity)).toBe(0.5);

    setDomain('other.com');
    expect(config.boostFn!(userEntity)).toBe(0);
  });

  it('should boost current user (self) to top with high boost value', () => {
    const [domain] = createSignal('example.com');
    const [userId] = createSignal('current-user-id');
    const config = createEntitySearchConfig(domain, userId);

    const selfEntity: CombinedEntity = {
      kind: 'user',
      id: 'current-user-id',
      data: {
        id: 'current-user-id',
        email: 'self@example.com',
        name: 'Current User',
      } as IUser,
    };

    const boost = config.boostFn!(selfEntity);
    expect(boost).toBe(10); // High boost for self
  });

  it('should prioritize self-boost over domain boost', () => {
    const [domain] = createSignal('example.com');
    const [userId] = createSignal('current-user-id');
    const config = createEntitySearchConfig(domain, userId);

    // Self user with same domain - should get self boost (10), not domain boost (0.5)
    const selfEntity: CombinedEntity = {
      kind: 'user',
      id: 'current-user-id',
      data: {
        id: 'current-user-id',
        email: 'self@example.com',
        name: 'Current User',
      } as IUser,
    };

    const boost = config.boostFn!(selfEntity);
    expect(boost).toBe(10);
  });

  it('should still apply domain boost for non-self users when currentUserId is provided', () => {
    const [domain] = createSignal('example.com');
    const [userId] = createSignal('current-user-id');
    const config = createEntitySearchConfig(domain, userId);

    const otherUserSameDomain: CombinedEntity = {
      kind: 'user',
      id: 'other-user-id',
      data: {
        id: 'other-user-id',
        email: 'other@example.com',
        name: 'Other User',
      } as IUser,
    };

    const boost = config.boostFn!(otherUserSameDomain);
    expect(boost).toBe(0.5); // Domain boost for same domain
  });

  it('should not boost non-self users with different domain', () => {
    const [domain] = createSignal('example.com');
    const [userId] = createSignal('current-user-id');
    const config = createEntitySearchConfig(domain, userId);

    const otherUserDifferentDomain: CombinedEntity = {
      kind: 'user',
      id: 'other-user-id',
      data: {
        id: 'other-user-id',
        email: 'other@different.com',
        name: 'Other User',
      } as IUser,
    };

    const boost = config.boostFn!(otherUserDifferentDomain);
    expect(boost).toBe(0);
  });
});

describe('sortEntitiesWithSelfFirst', () => {
  it('should move self to the front of the list', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
      {
        kind: 'user',
        id: 'current-user',
        data: {
          id: 'current-user',
          email: 'me@example.com',
          name: 'Me',
        } as IUser,
      },
      {
        kind: 'user',
        id: 'user-2',
        data: {
          id: 'user-2',
          email: 'user2@example.com',
          name: 'User 2',
        } as IUser,
      },
    ];

    const result = sortEntitiesWithSelfFirst(entities, 'current-user');

    expect(result[0].id).toBe('current-user');
    expect(result[1].id).toBe('user-1');
    expect(result[2].id).toBe('user-2');
  });

  it('should return entities unchanged if self is already first', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'user',
        id: 'current-user',
        data: {
          id: 'current-user',
          email: 'me@example.com',
          name: 'Me',
        } as IUser,
      },
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
    ];

    const result = sortEntitiesWithSelfFirst(entities, 'current-user');

    expect(result).toEqual(entities);
  });

  it('should return entities unchanged if self is not in the list', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
      {
        kind: 'user',
        id: 'user-2',
        data: {
          id: 'user-2',
          email: 'user2@example.com',
          name: 'User 2',
        } as IUser,
      },
    ];

    const result = sortEntitiesWithSelfFirst(entities, 'current-user');

    expect(result).toEqual(entities);
  });

  it('should return entities unchanged if currentUserId is undefined', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
    ];

    const result = sortEntitiesWithSelfFirst(entities, undefined);

    expect(result).toEqual(entities);
  });

  it('should only move user entities, not other entity types', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'entity',
        id: 'current-user',
        data: {
          type: 'channel',
          id: 'current-user',
          name: 'Channel',
        } as EntityData,
      },
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
    ];

    const result = sortEntitiesWithSelfFirst(entities, 'current-user');

    // Should not move the channel entity even though ID matches
    expect(result[0].kind).toBe('entity');
    expect(result[1].kind).toBe('user');
  });

  it('should not mutate the original array', () => {
    const entities: CombinedEntity[] = [
      {
        kind: 'user',
        id: 'user-1',
        data: {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
        } as IUser,
      },
      {
        kind: 'user',
        id: 'current-user',
        data: {
          id: 'current-user',
          email: 'me@example.com',
          name: 'Me',
        } as IUser,
      },
    ];

    const originalFirst = entities[0];
    sortEntitiesWithSelfFirst(entities, 'current-user');

    expect(entities[0]).toBe(originalFirst);
  });
});
