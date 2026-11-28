import type { ChannelEntity } from '@entity/types/entity';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authKeys } from '../../auth/keys';
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
  observeGraphqlSoupDeletions,
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
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const key = 'GraphqlSoupDocument:deleted';
    const deletion = createGraphqlSoupDeletion([key]);
    const ids = createRoot((cleanup) => {
      dispose = cleanup;
      return usePendingGraphqlSoupDeleteKeys();
    });
    const mutation = client.getMutationCache().build(client, {
      mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
      onMutate: () => ({ graphqlDeletion: deletion }),
      mutationFn: async () => true,
      onSettled: () => deletion.settle([key], new Map([[key, promise]])),
    });
    try {
      await mutation.execute(undefined);
      expect(mutation.state.status).toBe('success');
      client.getMutationCache().remove(mutation);
      expect([...ids()]).toEqual(['GraphqlSoupDocument:deleted']);
      resolve(true);
      await vi.waitFor(() => expect(ids().size).toBe(0));
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      deletion.release();
    }
  });

  it('expires an unacknowledged deletion without issuing any reads', async () => {
    vi.useFakeTimers();
    const deletion = createGraphqlSoupDeletion([
      'GraphqlSoupDocument:deleted',
      'GraphqlSoupDocument:failed',
    ]);
    deletion.settle(
      ['GraphqlSoupDocument:deleted'],
      new Map([['GraphqlSoupDocument:deleted', Promise.resolve(false)]])
    );
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS - 1);
    expect(deletion.keys()).toEqual(['GraphqlSoupDocument:deleted']);
    await vi.advanceTimersByTimeAsync(1);
    expect(deletion.keys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('expires ids even if an acknowledgement is late', async () => {
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const key = 'GraphqlSoupDocument:deleted';
    const deletion = createGraphqlSoupDeletion([key]);
    deletion.settle([key], new Map([[key, promise]]));
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(deletion.keys()).toEqual([]);
    resolve(true);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a late success only releases its own overlapping operation', async () => {
    const firstResult = Promise.withResolvers<boolean>();
    const secondResult = Promise.withResolvers<boolean>();
    const key = 'GraphqlSoupDocument:shared';
    const first = createGraphqlSoupDeletion([key]);
    const second = createGraphqlSoupDeletion([key]);
    try {
      first.settle([key], new Map([[key, firstResult.promise]]));
      second.settle([key], new Map([[key, secondResult.promise]]));
      firstResult.resolve(true);
      await vi.waitFor(() => expect(first.keys()).toEqual([]));
      expect(second.keys()).toEqual(['GraphqlSoupDocument:shared']);
      secondResult.resolve(true);
      await vi.waitFor(() => expect(second.keys()).toEqual([]));
    } finally {
      first.release();
      second.release();
    }
  });

  it('keeps a returned tombstone hidden until every mounted list has caught up', async () => {
    vi.useFakeTimers();
    const key = 'GraphqlSoupDocument:deleted';
    const [raw, publish] = createSignal([key]);
    createRoot((cleanup) => {
      dispose = cleanup;
      observeGraphqlSoupDeletions(raw);
    });
    const deletion = createGraphqlSoupDeletion([key]);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    try {
      deletion.settle([key], new Map([[key, promise]]));
      resolve(true);
      await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS * 2);
      expect(
        withoutPendingSoupEntities([{ id: key }], new Set(deletion.keys()))
      ).toEqual([]);
      publish([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(deletion.keys()).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      deletion.release();
    }
  });

  it('releases a history-only removal even when another list still includes the entity', async () => {
    const key = 'GraphqlSoupDocument:shared';
    createRoot((cleanup) => {
      dispose = cleanup;
      observeGraphqlSoupDeletions(() => [key]);
    });
    const deletion = createGraphqlSoupDeletion([key]);
    try {
      deletion.settle(
        [key],
        new Map([[key, Promise.resolve(true)]]),
        new Set([key])
      );
      await vi.waitFor(() => expect(deletion.keys()).toEqual([]));
    } finally {
      deletion.release();
    }
  });

  it('honors a sibling restore receipt only for older deletes of the same account', async () => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    const clock = vi.spyOn(performance, 'now');
    const key = 'GraphqlSoupDocument:shared';
    const otherKey = 'GraphqlSoupDocument:other';
    clock.mockReturnValue(1);
    const older = createGraphqlSoupDeletion([key, otherKey]);
    const waitingForAccess = createGraphqlSoupDeletion([key]);
    const origin = performance.timeOrigin;
    older.settle(
      [key, otherKey],
      undefined,
      undefined,
      new Map([
        [key, origin + 1],
        [otherKey, origin + 1],
      ])
    );
    clock.mockReturnValue(3);
    const newer = createGraphqlSoupDeletion([key]);
    newer.settle([key], undefined, undefined, new Map([[key, origin + 3]]));
    const peer = new BroadcastChannel('macro:soup-restore');
    try {
      const startedAt = performance.timeOrigin + 2;
      peer.postMessage({ viewerId: 'other', startedAt, keys: [otherKey] });
      peer.postMessage({ viewerId: 'viewer', startedAt, keys: [key] });
      await vi.waitFor(() => expect(older.keys()).toEqual([otherKey]));
      expect(newer.keys()).toEqual([key]);
      expect(waitingForAccess.keys()).toEqual([key]);
      waitingForAccess.settle(
        [key],
        undefined,
        undefined,
        new Map([[key, origin + 3]])
      );
      expect(waitingForAccess.keys()).toEqual([key]);
    } finally {
      peer.close();
      older.release();
      newer.release();
      waitingForAccess.release();
      clock.mockRestore();
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
