import { describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
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
      kind: 'channel',
      id: 'channel-1',
      data: {
        id: 'channel-1',
        name: 'Test Channel',
      } as any,
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
