import { QueryClient } from '@tanstack/solid-query';
import type { Persister } from '@tanstack/solid-query-persist-client';
import { describe, expect, it, vi } from 'vitest';
import {
  queryKeyHasPrefix,
  setupQueryPersistence,
  shouldPersistForScopeEvent,
  type PersistScope,
} from './persistence';

function createScope(prefix: readonly unknown[]): PersistScope {
  return {
    persister: {
      persistClient: vi.fn(async () => {}),
      restoreClient: vi.fn(async () => undefined),
      removeClient: vi.fn(async () => {}),
    } satisfies Persister,
    maxAgeMs: 1000,
    shouldDehydrateQuery: (query) => queryKeyHasPrefix(query.queryKey, prefix),
  };
}

describe('shouldPersistForScopeEvent', () => {
  it('returns false for non-cache events or missing query', () => {
    const scope = createScope(['channel']);
    expect(shouldPersistForScopeEvent({}, scope)).toBe(false);
    expect(
      shouldPersistForScopeEvent({ type: 'observerResultsUpdated' }, scope)
    ).toBe(false);
  });

  it('returns false for non-success query state', () => {
    const scope = createScope(['channel']);
    const event = {
      type: 'updated',
      query: {
        queryKey: ['channel', 'a'],
        state: { status: 'pending' },
      },
    };
    expect(shouldPersistForScopeEvent(event, scope)).toBe(false);
  });

  it('returns true only when query key matches the scope predicate', () => {
    const scope = createScope(['channel']);
    const channelEvent = {
      type: 'updated',
      query: {
        queryKey: ['channel', 'a'],
        state: { status: 'success' },
      },
    };
    const previewEvent = {
      type: 'updated',
      query: {
        queryKey: ['preview', 'a'],
        state: { status: 'success' },
      },
    };

    expect(shouldPersistForScopeEvent(channelEvent, scope)).toBe(true);
    expect(shouldPersistForScopeEvent(previewEvent, scope)).toBe(false);
  });
});

describe('setupQueryPersistence', () => {
  it('persists only for matching query updates', async () => {
    const queryClient = new QueryClient();
    const channelScope = createScope(['channel']);
    const emailScope = createScope(['email', 'threadMessages']);

    setupQueryPersistence({
      queryClient,
      buster: 'test',
      scopes: [channelScope, emailScope],
    });

    await Promise.resolve();
    await Promise.resolve();

    queryClient.setQueryData(['preview', 'item-a'], { value: 'preview' });
    await Promise.resolve();
    expect(channelScope.persister.persistClient).toHaveBeenCalledTimes(0);
    expect(emailScope.persister.persistClient).toHaveBeenCalledTimes(0);

    queryClient.setQueryData(['channel', 'item-a'], { value: 'channel' });
    await Promise.resolve();
    expect(channelScope.persister.persistClient).toHaveBeenCalledTimes(1);
    expect(emailScope.persister.persistClient).toHaveBeenCalledTimes(0);

    queryClient.setQueryData(['email', 'threadMessages', 't-1'], {
      value: 'email',
    });
    await Promise.resolve();
    expect(channelScope.persister.persistClient).toHaveBeenCalledTimes(1);
    expect(emailScope.persister.persistClient).toHaveBeenCalledTimes(1);
  });
});
