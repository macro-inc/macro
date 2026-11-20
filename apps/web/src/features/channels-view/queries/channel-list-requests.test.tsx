import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import type {
  Client,
  GraphQLRequest,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { CombinedError } from '@urql/core';
import { NIL as NIL_UUID } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, onEnd, pipe } from 'wonka';

/**
 * The sidebar's three bounded lists over the real Soup query, with only the
 * GraphQL client replaced: every request the lists make is counted here.
 */
const soupClient = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-storage/graphql-soup')>()),
  getGraphqlSoupClient: soupClient,
  getGraphqlSoupCacheHost: () => undefined,
  hasGraphqlCacheHost: () => false,
  graphqlSoupProjectionSupported: () => true,
  mapGraphqlSoupItem: (item: unknown) => item,
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: () => true,
  mapApiSoupItemToEntity: (item: unknown) => item,
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'viewer',
  useIsAuthenticated: () => () => true,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import {
  channelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from '@queries/channel/notification-refresh';
import { queryClient } from '@queries/client';
import { useCollapsedUnreadChannels } from '../components/rail/next/collapsed-unread-channels';
import { useChannelsSources } from '../queries';

type SoupRow = { __typename: string; id: string; type: string };

type SoupVariables = {
  input: {
    initial?: { limit?: number };
    continuation?: { cursor: string };
  };
};

type SoupRequest = {
  variables: SoupVariables;
  /** The list stopped listening: it unmounted or replaced the request. */
  closed: boolean;
  answer(): void;
  fail(): void;
};

const channelRow = (id: string) => ({
  __typename: 'GraphqlSoupChannel',
  type: 'channel',
  id,
  name: id,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const threadRow = (id: string, channelId: string) => ({
  __typename: 'GraphqlSoupChannelThread',
  type: 'channel_thread',
  id,
  channelId,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const numbered = (prefix: string, count: number) =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index).padStart(4, '0')}`
  );

/**
 * A Soup server over `rowsFor`, which names every row a request matches. Like
 * the real one, it returns a cursor whenever a page is full, whether or not
 * another row follows.
 */
function createSoupServer(rowsFor: (variables: SoupVariables) => SoupRow[]) {
  const requests: SoupRequest[] = [];

  const pageFor = (variables: SoupVariables) => {
    const { initial, continuation } = variables.input;
    const [offset, limit] = continuation
      ? continuation.cursor.split(':').map(Number)
      : [0, initial?.limit ?? 20];
    const items = rowsFor(variables).slice(offset, offset + limit);
    const nextCursor =
      items.length === limit ? `${offset + limit}:${limit}` : null;

    return { user: { soup: { items, nextCursor } } };
  };

  const refreshes = vi.fn((_document: unknown, variables: SoupVariables) => ({
    toPromise: async () => ({ data: pageFor(variables) }),
  }));

  const client = {
    executeQuery: (
      request: GraphQLRequest<unknown, SoupVariables>,
      context: Partial<OperationContext>
    ) => {
      const subject = makeSubject<OperationResult<unknown, SoupVariables>>();
      const operation = { kind: 'query', context } as OperationResult<
        unknown,
        SoupVariables
      >['operation'];
      const entry: SoupRequest = {
        variables: request.variables,
        closed: false,
        answer: () =>
          subject.next({
            operation,
            data: pageFor(request.variables),
            extensions: {
              __macroNormalizedCache: { source: 'live-network', revision: '1' },
            },
            stale: false,
            hasNext: false,
          }),
        fail: () =>
          subject.next({
            operation,
            error: new CombinedError({
              networkError: new Error('Soup is unavailable'),
            }),
            stale: false,
            hasNext: false,
          }),
      };
      requests.push(entry);

      return pipe(
        subject.source,
        onEnd(() => {
          entry.closed = true;
        })
      );
    },
    query: refreshes,
  } as unknown as Client;

  /** Answers requests until the lists stop asking for more. */
  const settle = async () => {
    let answered = 0;
    while (answered < requests.length) {
      // Answering one request can start the next before this loop moves on.
      for (; answered < requests.length; answered += 1)
        requests[answered].answer();
      await vi.advanceTimersByTimeAsync(0);
    }
  };

  return { client, requests, refreshes, settle };
}

function mount<T>(use: () => T): { result: T; unmount: () => void } {
  let result!: T;
  const Mounted = () => {
    result = use();
    return null;
  };
  const { unmount } = render(() => (
    <QueryClientProvider client={queryClient}>
      <Mounted />
    </QueryClientProvider>
  ));
  return { result, unmount };
}

/**
 * IDs named by a by-ID lookup's channel filter. Other lists exclude channels
 * with the nil ID, which names none.
 */
const lookedUpIds = (variables: SoupVariables) =>
  [...JSON.stringify(variables).matchAll(/"channelId":"([^"]+)"/g)]
    .map(([, id]) => id)
    .filter((id) => id !== NIL_UUID);

const limitsOf = (requests: SoupRequest[]) =>
  requests.map(({ variables }) => variables.input.initial?.limit);

describe('sidebar channel lists load in bounded requests', () => {
  let server: ReturnType<typeof createSoupServer>;

  const serve = (rowsFor: (variables: SoupVariables) => SoupRow[]) => {
    server = createSoupServer(rowsFor);
    soupClient.mockReturnValue(server.client);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
    disposeChannelNotificationRefresh(server.client);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves channels by ID in one request, and one more on return', async () => {
    const ids = numbered('channel', 30);
    serve((variables) => lookedUpIds(variables).map(channelRow));

    const first = mount(() =>
      useCachedChannelsByIds(
        () => ids,
        () => true
      )
    );
    await server.settle();

    // Every ID resolved fills the page it asked for. A lookup that asked for
    // exactly its IDs would be handed a cursor and read an empty second page.
    expect(limitsOf(server.requests)).toEqual([31]);
    expect(first.result.channels().map(({ id }) => id)).toEqual(ids);
    expect(first.result.isLoading()).toBe(false);
    first.unmount();

    const returned = mount(() =>
      useCachedChannelsByIds(
        () => ids,
        () => true
      )
    );
    await server.settle();

    expect(limitsOf(server.requests)).toEqual([31, 31]);
    expect(returned.result.channels()).toHaveLength(30);
  });

  it('splits a large ID set into bounded requests instead of pages', async () => {
    const ids = numbered('channel', 600);
    serve((variables) => lookedUpIds(variables).map(channelRow));

    const { result } = mount(() =>
      useCachedChannelsByIds(
        () => ids,
        () => true
      )
    );
    await server.settle();

    expect(limitsOf(server.requests)).toEqual([500, 102]);
    expect(result.channels()).toHaveLength(600);
    expect([...result.unavailableIds()]).toEqual([]);
  });

  it('reads collapsed unread channels in one request, capped at one page', async () => {
    const unread = numbered('unread', 700).map(channelRow);
    serve(() => unread);

    const { result } = mount(() => useCollapsedUnreadChannels(() => true));
    await server.settle();

    expect(limitsOf(server.requests)).toEqual([500]);
    expect(result()).toHaveLength(500);
  });

  it('refreshes collapsed unread channels with one request per notification', async () => {
    const unread = numbered('unread', 150).map(channelRow);
    serve(() => unread);

    const { result } = mount(() => useCollapsedUnreadChannels(() => true));
    await server.settle();
    expect(result()).toHaveLength(150);

    channelNotificationRefresh(server.client).reconnect();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(server.requests).toHaveLength(1);
    expect(server.refreshes).toHaveBeenCalledOnce();
  });

  it('stops listening on unmount and ignores a late answer', async () => {
    serve(() => numbered('unread', 700).map(channelRow));

    const { unmount } = mount(() => useCollapsedUnreadChannels(() => true));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests).toHaveLength(1);
    unmount();

    expect(server.requests[0].closed).toBe(true);
    server.requests[0].answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.requests).toHaveLength(1);
  });

  it('reports a failed load without retrying it', async () => {
    serve(() => numbered('unread', 700).map(channelRow));
    const ids = numbered('channel', 30);

    const unread = mount(() => useCollapsedUnreadChannels(() => true));
    const lookup = mount(() =>
      useCachedChannelsByIds(
        () => ids,
        () => true
      )
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests).toHaveLength(2);
    for (const request of server.requests) request.fail();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(server.requests).toHaveLength(2);
    expect(unread.result()).toEqual([]);
    expect(lookup.result.error()).toBeInstanceOf(CombinedError);
    expect([...lookup.result.failedIds()]).toEqual(ids);
  });

  it('loads the Threads rail in one thread request and one channel lookup', async () => {
    const channels = ['design', 'eng', 'support'];
    const threads = numbered('thread', 700).map((id, index) =>
      threadRow(id, channels[index % channels.length])
    );
    serve((variables) => {
      const ids = lookedUpIds(variables);
      return ids.length ? ids.map(channelRow) : threads;
    });

    const { result } = mount(() =>
      useChannelsSources(
        (scope) => scope === 'threads',
        () => 'created_at'
      )
    );
    await server.settle();

    // The first 500 threads, then the three channels they belong to.
    expect(limitsOf(server.requests)).toEqual([500, 4]);
    expect(
      result.threads
        .items()
        .map(({ id }) => id)
        .sort()
    ).toEqual(channels);

    // Older threads load only when the rail is scrolled.
    expect(result.threads.hasMore()).toBe(true);
    const more = result.threads.loadMore();
    await server.settle();
    await more;
    expect(server.requests).toHaveLength(3);
    expect(server.requests[2].variables.input.continuation?.cursor).toBe(
      '500:500'
    );
  });
});
