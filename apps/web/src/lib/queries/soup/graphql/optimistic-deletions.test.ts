import type { ChannelEntity } from '@entity/types/entity';
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
  prepareGraphqlSoupRestore,
  usePendingGraphqlSoupDeleteKeys,
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
  it('does not resurrect restored ids when an earlier deletion settles late', async () => {
    refresh.mockReturnValue(new Promise<void>(() => {}));
    const deletion = createGraphqlSoupDeletion([
      'GraphqlSoupDocument:restored',
      'GraphqlSoupDocument:sibling',
    ]);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const network = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
      onMutate: () => ({ graphqlDeletion: deletion }),
      mutationFn: async () => {
        started();
        await network;
      },
      onSettled: () =>
        deletion.settle([
          'GraphqlSoupDocument:restored',
          'GraphqlSoupDocument:sibling',
        ]),
    });
    const request = mutation.execute(undefined);
    await ready;
    try {
      const confirmRestore = prepareGraphqlSoupRestore();
      confirmRestore(['GraphqlSoupDocument:restored']);
      finish();
      await request;
      expect(deletion.keys()).toEqual(['GraphqlSoupDocument:sibling']);
    } finally {
      deletion.release();
    }
  });

  it('retains confirmed ids after their completed mutation is garbage collected', async () => {
    let finishRefresh!: () => void;
    refresh.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
    );
    const deletion = createGraphqlSoupDeletion(['GraphqlSoupDocument:deleted']);
    const ids = createRoot((cleanup) => {
      dispose = cleanup;
      return usePendingGraphqlSoupDeleteKeys();
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
      onMutate: () => ({ graphqlDeletion: deletion }),
      mutationFn: async () => true,
      onSettled: () => deletion.settle(['GraphqlSoupDocument:deleted']),
    });
    try {
      await mutation.execute(undefined);
      expect(mutation.state.status).toBe('success');
      client.getMutationCache().remove(mutation);
      expect([...ids()]).toEqual(['GraphqlSoupDocument:deleted']);
      finishRefresh();
      await vi.waitFor(() => expect(ids().size).toBe(0));
    } finally {
      deletion.release();
    }
  });

  it('bounds retries and expires retained ids even when every refresh fails', async () => {
    vi.useFakeTimers();
    refresh.mockRejectedValue(new Error('offline'));
    const deletion = createGraphqlSoupDeletion([
      'GraphqlSoupDocument:deleted',
      'GraphqlSoupDocument:failed',
    ]);
    deletion.settle(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS - 3001);
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(1);
    expect(deletion.keys()).toEqual([]);
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
    const deletion = createGraphqlSoupDeletion(['GraphqlSoupDocument:deleted']);
    deletion.settle(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(deletion.keys()).toEqual([]);
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
    const first = createGraphqlSoupDeletion(['GraphqlSoupDocument:shared']);
    const second = createGraphqlSoupDeletion(['GraphqlSoupDocument:shared']);
    try {
      first.settle(['GraphqlSoupDocument:shared']);
      second.settle(['GraphqlSoupDocument:shared']);
      finishFirst();
      await vi.waitFor(() => expect(first.keys()).toEqual([]));
      expect(second.keys()).toEqual(['GraphqlSoupDocument:shared']);
      finishSecond();
      await vi.waitFor(() => expect(second.keys()).toEqual([]));
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
    expect(
      withoutPendingGraphqlSoupDeletes(
        original,
        new Set(['GraphqlSoupDocument:other'])
      )
    ).toBe(original);
    expect(
      withoutPendingGraphqlSoupDeletes(
        undefined,
        new Set(['GraphqlSoupDocument:a'])
      )
    ).toBeUndefined();
  });

  it('filters grouped membership, row pools, and known counts without changing cursors or source data', () => {
    const original = data();
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['GraphqlSoupDocument:a', 'GraphqlSoupDocument:b'])
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

  it('removes deleted group members even when the row was already removed from the visible list', () => {
    const original = { ...data(), entities: [] };
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['GraphqlSoupDocument:a'])
    );
    expect(filtered?.groups?.[0].itemIds).toEqual(['b']);
    expect(filtered?.groups?.[0].totalCount).toBe(9);
    expect(Object.keys(filtered?.itemsById ?? {})).toEqual(['b', 'c']);
  });

  it('keeps a channel visible when a document with the same ID is deleted', () => {
    const channel: ChannelEntity = {
      id: 'a',
      type: 'channel',
      name: 'Channel',
      ownerId: 'owner',
      channelType: 'private',
    };
    const original = { ...data(), entities: [data().entities[0], channel] };
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['GraphqlSoupDocument:a'])
    );
    expect(filtered?.entities).toEqual([channel]);
    expect(filtered?.entities[0]).toBe(channel);
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
      new Set(['GraphqlSoupDocument:b'])
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
      return usePendingGraphqlSoupDeleteKeys();
    });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = client
      .getMutationCache()
      .build(client, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({
          graphqlDeletion: createGraphqlSoupDeletion([
            'GraphqlSoupDocument:a',
            'GraphqlSoupDocument:b',
          ]),
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
          graphqlDeletion: createGraphqlSoupDeletion([
            'GraphqlSoupDocument:b',
            'GraphqlSoupDocument:c',
          ]),
        }),
        onSettled: (_data, _error, _vars, context) =>
          context?.graphqlDeletion.release(),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            releaseSecond = resolve;
          }),
      })
      .execute(undefined);
    await vi.waitFor(() =>
      expect([...ids()]).toEqual([
        'GraphqlSoupDocument:a',
        'GraphqlSoupDocument:b',
        'GraphqlSoupDocument:c',
      ])
    );
    releaseFirst();
    await first;
    await vi.waitFor(() =>
      expect([...ids()]).toEqual([
        'GraphqlSoupDocument:b',
        'GraphqlSoupDocument:c',
      ])
    );
    releaseSecond();
    await second;
    await vi.waitFor(() => expect(ids().size).toBe(0));
  });
});
