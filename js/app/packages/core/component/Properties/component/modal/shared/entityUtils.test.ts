import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';

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

import { createEntitySearchConfig } from './entityUtils';
import type { CombinedEntity } from './entityUtils';
import type { IUser } from '@core/user';

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
});
