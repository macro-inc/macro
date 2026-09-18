import { QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupAstItemsData } from '../items';

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('./active-queries', () => ({
  refreshActiveGraphqlSoupQueries: refresh,
}));

vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

import {
  createGraphqlSoupDeletion,
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
  GRAPHQL_SOUP_DELETE_RETENTION_MS,
  usePendingGraphqlSoupDeleteIds,
  withoutPendingGraphqlSoupDeletes,
  withoutPendingSoupEntities,
} from './optimistic-deletions';

let client: QueryClient;
let dispose: (() => void) | undefined;
beforeEach(() => {
  refresh.mockReset().mockResolvedValue(undefined);
  client = new QueryClient();
});
afterEach(() => {
  dispose?.();
  client.clear();
  vi.useRealTimers();
});

function data(): SoupAstItemsData {
  return {
    entities: ['a', 'b', 'c'].map(
      (id) => ({ id, type: 'document' }) as SoupAstItemsData['entities'][number]
    ),
    groups: [
      {
        key: 'one',
        label: 'One',
        displayOrder: 0,
        totalCount: 10,
        itemIds: ['a', 'b'],
        nextCursor: 'next',
      },
      {
        key: 'two',
        label: 'Two',
        displayOrder: 1,
        totalCount: 1,
        itemIds: ['c'],
        nextCursor: null,
      },
    ],
    itemsById: Object.fromEntries(
      ['a', 'b', 'c'].map((id) => [id, { tag: 'document', data: { id } }])
    ) as SoupAstItemsData['itemsById'],
    oldestFetchedTimestamp: 123,
  };
}

describe('GraphQL Soup deletion lifecycle', () => {
  it('retains confirmed ids after their completed mutation is garbage collected', async () => {
    let finishRefresh!: () => void;
    refresh.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );
    const deletion = createGraphqlSoupDeletion(['deleted']);
    const ids = createRoot((cleanup) => {
      dispose = cleanup;
      return usePendingGraphqlSoupDeleteIds();
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
      onMutate: () => ({ graphqlDeletion: deletion }),
      mutationFn: async () => true,
      onSettled: () => deletion.settle(['deleted']),
    });
    try {
      await mutation.execute(undefined);
      expect(mutation.state.status).toBe('success');
      client.getMutationCache().remove(mutation);
      expect([...ids()]).toEqual(['deleted']);
      finishRefresh();
      await vi.waitFor(() => expect(ids().size).toBe(0));
    } finally {
      deletion.release();
    }
  });

  it('bounds retries and expires retained ids even when every refresh fails', async () => {
    vi.useFakeTimers();
    refresh.mockRejectedValue(new Error('offline'));
    const deletion = createGraphqlSoupDeletion(['deleted', 'failed']);
    deletion.settle(['deleted']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(deletion.ids()).toEqual(['deleted']);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS - 3001);
    expect(deletion.ids()).toEqual(['deleted']);
    await vi.advanceTimersByTimeAsync(1);
    expect(deletion.ids()).toEqual([]);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('expires ids even if a refresh never settles and does not restart after a late failure', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    refresh.mockReturnValue(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
    );
    const deletion = createGraphqlSoupDeletion(['deleted']);
    deletion.settle(['deleted']);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(deletion.ids()).toEqual([]);
    reject(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('a late success only releases its own overlapping operation', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    refresh
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        })
      );
    const first = createGraphqlSoupDeletion(['shared']);
    const second = createGraphqlSoupDeletion(['shared']);
    try {
      first.settle(['shared']);
      second.settle(['shared']);
      finishFirst();
      await vi.waitFor(() => expect(first.ids()).toEqual([]));
      expect(second.ids()).toEqual(['shared']);
      finishSecond();
      await vi.waitFor(() => expect(second.ids()).toEqual([]));
    } finally {
      first.release();
      second.release();
    }
  });
});

describe('GraphQL Soup pending delete projection', () => {
  it('preserves unchanged data identity', () => {
    const original = data();
    expect(withoutPendingGraphqlSoupDeletes(original, new Set())).toBe(
      original
    );
    expect(withoutPendingGraphqlSoupDeletes(original, new Set(['other']))).toBe(
      original
    );
    expect(
      withoutPendingGraphqlSoupDeletes(undefined, new Set(['a']))
    ).toBeUndefined();
  });

  it('filters grouped membership, row pools, and known counts without changing cursors or source data', () => {
    const original = data();
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['a', 'b'])
    )!;
    expect(filtered.entities).toEqual([original.entities[2]]);
    expect(filtered.groups?.[0]).toEqual({
      ...original.groups![0],
      itemIds: [],
      totalCount: 8,
    });
    expect(filtered.groups?.[1]).toBe(original.groups?.[1]);
    expect(Object.keys(filtered.itemsById!)).toEqual(['c']);
    expect(filtered.oldestFetchedTimestamp).toBe(123);
    expect(original.entities).toHaveLength(3);
    expect(original.groups?.[0].itemIds).toEqual(['a', 'b']);
    expect(Object.keys(original.itemsById!)).toEqual(['a', 'b', 'c']);
    expect(withoutPendingGraphqlSoupDeletes(original, new Set())).toBe(
      original
    );
  });

  it('filters flat/local-reconciled rows while preserving unrelated rows and metadata', () => {
    const original = {
      ...data(),
      groups: undefined,
      itemsById: undefined,
      cachedMail: true,
    };
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['b'])
    )!;
    expect(filtered.entities).toEqual([
      original.entities[0],
      original.entities[2],
    ]);
    expect(filtered.entities[0]).toBe(original.entities[0]);
    expect(filtered.cachedMail).toBe(true);
    expect(filtered.oldestFetchedTimestamp).toBe(123);
    expect(withoutPendingSoupEntities(original.entities, new Set())).toBe(
      original.entities
    );
  });

  it('keeps overlapping deletes hidden until each operation releases its ids', async () => {
    const ids = createRoot((cleanup) => {
      dispose = cleanup;
      return usePendingGraphqlSoupDeleteIds();
    });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = client
      .getMutationCache()
      .build(client, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({
          graphqlDeletion: createGraphqlSoupDeletion(['a', 'b']),
        }),
        onSettled: (_data, _error, _vars, context) =>
          context?.graphqlDeletion.release(),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      })
      .execute(undefined);
    const second = client
      .getMutationCache()
      .build(client, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({
          graphqlDeletion: createGraphqlSoupDeletion(['b', 'c']),
        }),
        onSettled: (_data, _error, _vars, context) =>
          context?.graphqlDeletion.release(),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            releaseSecond = resolve;
          }),
      })
      .execute(undefined);
    await vi.waitFor(() => expect([...ids()]).toEqual(['a', 'b', 'c']));
    releaseFirst();
    await first;
    await vi.waitFor(() => expect([...ids()]).toEqual(['b', 'c']));
    releaseSecond();
    await second;
    await vi.waitFor(() => expect(ids().size).toBe(0));
  });
});
