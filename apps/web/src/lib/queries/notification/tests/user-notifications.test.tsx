/**
 * @vitest-environment jsdom
 */

import type { UnifiedNotification } from '@notifications/types';
import type { ApiUserNotification } from '@service-notification/generated/schemas/apiUserNotification';
import type { GetAllUserNotificationsResponse } from '@service-notification/generated/schemas/getAllUserNotificationsResponse';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createEffect, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationKeys } from '../keys';
import {
  optimisticInsertNotification,
  type UserNotificationsQuery,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
  useUserNotificationsQuery,
} from '../user-notifications';

const {
  createGraphqlMutationMock,
  createGraphqlQueryMock,
  executeGraphqlMutationMock,
  graphqlCacheEnabledMock,
  refreshActiveSoupQueriesMock,
  restUserNotificationsMock,
} = vi.hoisted(() => ({
  createGraphqlMutationMock: vi.fn(),
  createGraphqlQueryMock: vi.fn(),
  executeGraphqlMutationMock: vi.fn(),
  graphqlCacheEnabledMock: vi.fn(() => true),
  refreshActiveSoupQueriesMock: vi.fn(async () => undefined),
  restUserNotificationsMock: vi.fn(),
}));

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
    userNotifications: restUserNotificationsMock,
    bulkGetUserNotificationsByEventItemId: vi.fn(),
  },
  channelMentionMetadata: {},
  documentMentionMetadata: {},
}));

vi.mock('../graphql/user-notifications', () => ({
  createGraphqlNotificationsQuery: createGraphqlQueryMock,
  createGraphqlUpdateNotificationsMutation: createGraphqlMutationMock,
}));

vi.mock('@service-storage/graphql-notifications', () => ({
  updateNotifications: vi.fn(),
}));

vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: refreshActiveSoupQueriesMock,
}));

vi.mock('@queries/soup/normalized-cache', () => ({
  bumpSoupEntityNotifiedAt: vi.fn(),
  optimisticUpdateSoupItemUpdatedAt: vi.fn(),
  hasSoupEntity: vi.fn(() => false),
  refetchSoupEntity: vi.fn(),
  restoreSoupEntityToDoneFilteredQueries: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: graphqlCacheEnabledMock,
}));

import {
  bumpSoupEntityNotifiedAt,
  hasSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  restoreSoupEntityToDoneFilteredQueries,
} from '@queries/soup/normalized-cache';

const mockOptimisticUpdateSoupItemUpdatedAt = vi.mocked(
  optimisticUpdateSoupItemUpdatedAt
);
const mockHasSoupEntity = vi.mocked(hasSoupEntity);
const mockRefetchSoupEntity = vi.mocked(refetchSoupEntity);

let testQueryClient: QueryClient;

type GraphqlMutationInput = { notificationIds: string[] };
type GraphqlMutationOptions = {
  operation: string;
  onMutate?: (input: GraphqlMutationInput) => unknown | Promise<unknown>;
  onSuccess?: (
    data: unknown[],
    input: GraphqlMutationInput,
    context: unknown
  ) => unknown;
  onError?: (
    error: Error,
    input: GraphqlMutationInput,
    context: unknown
  ) => unknown;
  onSettled?: (
    data: unknown[] | undefined,
    error: Error | null,
    input: GraphqlMutationInput,
    context: unknown
  ) => unknown;
};

const inFlightMutations = new Set<Promise<unknown>>();

afterEach(async () => {
  const pending = [...inFlightMutations];
  inFlightMutations.clear();
  await Promise.all(pending);
});

beforeEach(() => {
  graphqlCacheEnabledMock.mockReturnValue(true);
  restUserNotificationsMock.mockResolvedValue(
    ok({ items: [], next_cursor: null })
  );
  createGraphqlQueryMock.mockReturnValue({
    data: [],
    error: null,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(async () => undefined),
    refetch: vi.fn(async () => undefined),
  });
  createGraphqlMutationMock.mockImplementation(
    (options: GraphqlMutationOptions) => {
      let isPending = false;
      let error: Error | null = null;
      const mutateAsync = async (input: GraphqlMutationInput) => {
        isPending = true;
        const context = await options.onMutate?.(input);
        try {
          const data = (await executeGraphqlMutationMock({
            ...input,
            operation: options.operation,
          })) as unknown[];
          await options.onSuccess?.(data, input, context);
          await options.onSettled?.(data, null, input, context);
          return { data: { updateNotifications: data } };
        } catch (cause) {
          error = cause instanceof Error ? cause : new Error(String(cause));
          await options.onError?.(error, input, context);
          await options.onSettled?.(undefined, error, input, context);
          return { error };
        } finally {
          isPending = false;
        }
      };

      return {
        get isPending() {
          return isPending;
        },
        get error() {
          return error;
        },
        mutate: (input: GraphqlMutationInput) => {
          inFlightMutations.add(mutateAsync(input));
        },
        mutateAsync,
      };
    }
  );
});

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

type UserNotificationsPageParam = { limit: number; cursor?: string };

function createMockNotification(
  overrides: Partial<UnifiedNotification> = {}
): UnifiedNotification {
  return {
    id: `notification-${Math.random().toString(36).slice(2)}`,
    entity_id: 'entity-1',
    entity_type: 'document',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    viewed_at: null,
    deleted_at: null,
    state: 'unseen',
    sent: true,
    notification_event_type: 'item_shared_user',
    notification_metadata: {
      tag: 'item_shared_user',
      content: {
        sharedBy: 'user-1',
        permissionLevel: 'editor',
      },
    },
    ...overrides,
  } as UnifiedNotification;
}

function createMockNotificationPage(
  notifications: UnifiedNotification[],
  nextCursor?: string
): GetAllUserNotificationsResponse {
  return {
    items: notifications as unknown as ApiUserNotification[],
    next_cursor: nextCursor,
  };
}

function seedQueryCache(pages: GetAllUserNotificationsResponse[], limit = 20) {
  const queryKey = notificationKeys.user({ limit }).queryKey;
  testQueryClient.setQueryData(queryKey, {
    pages,
    pageParams: pages.map((_, i) => ({
      limit,
      cursor: i > 0 ? `cursor-${i}` : undefined,
    })),
  });
  return queryKey;
}

function getNotificationsFromCache(limit = 20) {
  const queryKey = notificationKeys.user({ limit }).queryKey;
  const data = testQueryClient.getQueryData<{
    pages: GetAllUserNotificationsResponse[];
    pageParams: UserNotificationsPageParam[];
  }>(queryKey);
  return data?.pages.flatMap((p) => p.items) ?? [];
}

function createWrapper() {
  return function Wrapper(props: { children: JSX.Element }) {
    return (
      <QueryClientProvider client={testQueryClient}>
        {props.children}
      </QueryClientProvider>
    );
  };
}

function renderWithClient(Component: () => JSX.Element): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const Wrapper = createWrapper();
  const dispose = render(
    () => (
      <Wrapper>
        <Component />
      </Wrapper>
    ),
    container
  );
  return () => {
    dispose();
    container.remove();
  };
}

describe('state-aware notification cache partitions', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });
  afterEach(() => testQueryClient.clear());
  it('keeps optimistic inserts out of done history', () => {
    const notification = createMockNotification({
      id: 'partitioned',
      state: 'unseen',
    });
    const activeKey = seedQueryCache([
      createMockNotificationPage([notification]),
    ]);
    const historyKey = notificationKeys.user({
      limit: 20,
      done: true,
    }).queryKey;
    testQueryClient.setQueryData(historyKey, {
      pages: [createMockNotificationPage([])],
      pageParams: [{ limit: 20 }],
    });
    const history = () =>
      testQueryClient.getQueryData<{
        pages: GetAllUserNotificationsResponse[];
      }>(historyKey)!.pages[0].items;
    optimisticInsertNotification(
      createMockNotification({ id: 'fresh', state: 'unseen' })
    );
    expect(history()).toHaveLength(0);
    expect(getNotificationsFromCache().map((n) => n.id)).toEqual([
      'fresh',
      'partitioned',
    ]);
    expect(testQueryClient.getQueryData(activeKey)).toBeDefined();
  });
});

describe('useUserNotificationsQuery transport facade', () => {
  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  it('defers the full GraphQL feed until a data/status reader needs it, preserving pagination', async () => {
    createGraphqlQueryMock.mockClear();
    restUserNotificationsMock.mockClear();
    const fetchNextPage = vi.fn(async () => {});
    const refetch = vi.fn(async () => {});
    createGraphqlQueryMock.mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage,
      refetch,
    });
    let query!: UserNotificationsQuery;
    const dispose = renderWithClient(() => {
      query = useUserNotificationsQuery(() => ({ limit: 500 }));
      return <div />;
    });
    try {
      expect(query.transport).toBe('graphql');
      expect(query.isStarted).toBe(false);
      expect(createGraphqlQueryMock).not.toHaveBeenCalled();
      expect(restUserNotificationsMock).not.toHaveBeenCalled();
      expect(query.isLoading).toBe(false);
      expect(query.isStarted).toBe(true);
      expect(query.data).toEqual([]);
      expect(createGraphqlQueryMock).toHaveBeenCalledOnce();
      expect(query.hasNextPage).toBe(true);
      await query.fetchNextPage();
      await query.refetch();
      expect(fetchNextPage).toHaveBeenCalledOnce();
      expect(refetch).toHaveBeenCalledWith({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
      expect(createGraphqlQueryMock).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('notifies gated consumers only after the lazy feed has been constructed', () => {
    createGraphqlQueryMock.mockClear();
    const reads = vi.fn();
    let query!: UserNotificationsQuery;
    const dispose = renderWithClient(() => {
      query = useUserNotificationsQuery(() => ({ limit: 500 }));
      createEffect(() => {
        if (query.isStarted) reads(query.data);
      });
      return <div />;
    });
    try {
      expect(query.isStarted).toBe(false);
      expect(reads).not.toHaveBeenCalled();
      expect(createGraphqlQueryMock).not.toHaveBeenCalled();
      expect(query.isLoading).toBe(false);
      expect(reads).toHaveBeenCalledExactlyOnceWith([]);
      expect(createGraphqlQueryMock).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('reads active notifications from the GraphQL query', () => {
    const graphqlNotification = createMockNotification({ id: 'graphql-1' });
    createGraphqlQueryMock.mockReturnValue({
      data: [graphqlNotification],
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(async () => undefined),
      refetch: vi.fn(async () => undefined),
    });
    let query: UserNotificationsQuery | undefined;

    const dispose = renderWithClient(() => {
      query = useUserNotificationsQuery(() => ({ limit: 500 }));
      return <div />;
    });

    expect(query?.transport).toBe('graphql');
    expect(query?.data).toEqual([graphqlNotification]);
    const [queryArgs, queryOptions] = createGraphqlQueryMock.mock.calls.at(-1)!;
    expect(queryArgs()).toEqual({ limit: 500 });
    expect(queryOptions()).toEqual({ enabled: true });
    dispose();
  });

  it('keeps done-history pagination on REST', () => {
    let query: UserNotificationsQuery | undefined;

    const dispose = renderWithClient(() => {
      query = useUserNotificationsQuery(() => ({ limit: 50, done: true }));
      return <div />;
    });

    expect(query?.transport).toBe('rest');
    dispose();
  });
});

describe('notification mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  describe('useMarkNotificationsAsSeenMutation', () => {
    it('should optimistically update viewed_at when marking as seen', async () => {
      const n1 = createMockNotification({
        id: 'n1',
        viewed_at: null,
        state: 'unseen',
      });
      const n2 = createMockNotification({
        id: 'n2',
        viewed_at: null,
        state: 'unseen',
      });
      seedQueryCache([createMockNotificationPage([n1, n2])]);

      executeGraphqlMutationMock.mockResolvedValue([]);

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n1'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      expect(executeGraphqlMutationMock).toHaveBeenCalledWith({
        notificationIds: ['n1'],
        operation: 'MARK_SEEN',
      });
      const notifications = getNotificationsFromCache();
      expect(typeof notifications[0].viewed_at).toBe('string');
      expect(notifications[1].viewed_at).toBe(null);
      expect(refreshActiveSoupQueriesMock).not.toHaveBeenCalled();

      cleanup();
    });

    it('refreshes active Soup queries when the GraphQL cache is unavailable', async () => {
      graphqlCacheEnabledMock.mockReturnValue(false);
      executeGraphqlMutationMock.mockResolvedValue([]);

      let mutatePromise: Promise<unknown> | undefined;
      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n1'] });
        return null;
      };
      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      expect(refreshActiveSoupQueriesMock).toHaveBeenCalledOnce();
      cleanup();
    });

    it('should rollback optimistic update on error', async () => {
      const n1 = createMockNotification({
        id: 'n1',
        viewed_at: null,
        state: 'unseen',
      });
      seedQueryCache([createMockNotificationPage([n1])]);

      executeGraphqlMutationMock.mockRejectedValue(
        new Error('Failed to mark as seen')
      );

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation
          .mutateAsync({ notificationIds: ['n1'] })
          .catch(() => {});
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;
      // Wait for rollback to complete
      await new Promise((r) => setTimeout(r, 10));

      const notifications = getNotificationsFromCache();
      expect(notifications[0].viewed_at).toBe(null);

      cleanup();
    });

    it('should handle marking notifications across multiple pages', async () => {
      const n1 = createMockNotification({
        id: 'n1',
        viewed_at: null,
        state: 'unseen',
      });
      const n2 = createMockNotification({
        id: 'n2',
        viewed_at: null,
        state: 'unseen',
      });
      seedQueryCache([
        createMockNotificationPage([n1]),
        createMockNotificationPage([n2]),
      ]);

      executeGraphqlMutationMock.mockResolvedValue([]);

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsSeenMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n2'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(notifications[0].viewed_at).toBe(null); // n1 unchanged
      expect(typeof notifications[1].viewed_at).toBe('string'); // n2 updated

      cleanup();
    });
  });

  describe('useMarkNotificationsAsDoneMutation', () => {
    it('should optimistically remove notifications when marking as done', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      const n3 = createMockNotification({ id: 'n3' });
      seedQueryCache([createMockNotificationPage([n1, n2, n3])]);

      executeGraphqlMutationMock.mockResolvedValue([]);

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n1', 'n3'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      expect(executeGraphqlMutationMock).toHaveBeenCalledWith({
        notificationIds: ['n1', 'n3'],
        operation: 'MARK_DONE',
      });
      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe('n2');

      cleanup();
    });

    it('should rollback optimistic removal on error', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      seedQueryCache([createMockNotificationPage([n1, n2])]);

      executeGraphqlMutationMock.mockRejectedValue(
        new Error('Connection failed')
      );

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation
          .mutateAsync({ notificationIds: ['n1'] })
          .catch(() => {});
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;
      // Wait for rollback to complete
      await new Promise((r) => setTimeout(r, 10));

      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(2);
      expect(notifications.find((n) => n.id === 'n1')).toBeDefined();

      cleanup();
    });

    it('should handle removing notifications across multiple pages', async () => {
      const n1 = createMockNotification({ id: 'n1' });
      const n2 = createMockNotification({ id: 'n2' });
      const n3 = createMockNotification({ id: 'n3' });
      seedQueryCache([
        createMockNotificationPage([n1, n2]),
        createMockNotificationPage([n3]),
      ]);

      executeGraphqlMutationMock.mockResolvedValue([]);

      let mutatePromise: Promise<unknown> | undefined;

      const TestComponent = () => {
        const mutation = useMarkNotificationsAsDoneMutation();
        mutatePromise = mutation.mutateAsync({ notificationIds: ['n2', 'n3'] });
        return null;
      };

      const cleanup = renderWithClient(TestComponent);

      await mutatePromise;

      const notifications = getNotificationsFromCache();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe('n1');

      cleanup();
    });
  });
});

describe('optimisticInsertNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  it('should insert notification at the beginning of the first page', () => {
    mockHasSoupEntity.mockReturnValue(true);
    const n1 = createMockNotification({ id: 'n1' });
    const n2 = createMockNotification({ id: 'n2' });
    seedQueryCache([createMockNotificationPage([n1, n2])]);

    const newNotification = createMockNotification({ id: 'new-notification' });
    optimisticInsertNotification(newNotification);

    const notifications = getNotificationsFromCache();
    expect(notifications).toHaveLength(3);
    expect(notifications[0].id).toBe('new-notification');
    expect(notifications[1].id).toBe('n1');
    expect(notifications[2].id).toBe('n2');
    expect(mockOptimisticUpdateSoupItemUpdatedAt).toHaveBeenCalledWith(
      newNotification.entity_id,
      'document',
      newNotification.created_at
    );
    // The inbox's notified_at order moves the row up on arrival.
    expect(vi.mocked(bumpSoupEntityNotifiedAt)).toHaveBeenCalledWith(
      newNotification.entity_id,
      newNotification.created_at
    );
    // A row marked done was removed from the done-filtered feeds; the merge
    // above can't restore page membership, so the insert path re-adds it.
    expect(
      vi.mocked(restoreSoupEntityToDoneFilteredQueries)
    ).toHaveBeenCalledWith(newNotification.entity_id, 'unseen');
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('should not insert duplicate notifications', () => {
    const n1 = createMockNotification({ id: 'n1' });
    const n2 = createMockNotification({ id: 'n2' });
    seedQueryCache([createMockNotificationPage([n1, n2])]);

    const duplicateNotification = createMockNotification({ id: 'n1' });
    optimisticInsertNotification(duplicateNotification);

    const notifications = getNotificationsFromCache();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe('n1');
    expect(notifications[1].id).toBe('n2');
  });

  it('stamps the thread row for a thread-scoped channel notification', () => {
    // The channel row is cached, the thread row is not.
    mockHasSoupEntity.mockImplementation((id) => id === 'channel-1');
    seedQueryCache([createMockNotificationPage([])]);

    const mention = createMockNotification({
      entity_type: 'channel',
      entity_id: 'channel-1',
      created_at: '2024-01-01T00:00:00.000Z',
      notification_event_type: 'channel_mention',
      notification_metadata: {
        tag: 'channel_mention',
        content: {
          messageContent: 'hey @you',
          messageId: 'msg-1',
          threadId: 'thread-1',
        },
      },
    } as unknown as Partial<UnifiedNotification>);

    optimisticInsertNotification(mention);

    // The channel row still tracks recency, but the notification belongs to
    // the thread row, which is what the inbox's notified_at order keys on.
    expect(mockOptimisticUpdateSoupItemUpdatedAt).toHaveBeenCalledWith(
      'channel-1',
      'channel',
      '2024-01-01T00:00:00.000Z'
    );
    expect(vi.mocked(bumpSoupEntityNotifiedAt)).toHaveBeenCalledWith(
      'thread-1',
      '2024-01-01T00:00:00.000Z'
    );
    expect(vi.mocked(bumpSoupEntityNotifiedAt)).not.toHaveBeenCalledWith(
      'channel-1',
      expect.anything()
    );
    expect(mockRefetchSoupEntity).toHaveBeenCalledWith(
      'thread-1',
      'channelThread',
      { notified: true }
    );
    expect(mockRefetchSoupEntity).not.toHaveBeenCalledWith(
      'channel-1',
      expect.anything()
    );
    // The feed row for a thread-scoped notification is the thread, so that is
    // the row restored into the done-filtered feeds.
    expect(
      vi.mocked(restoreSoupEntityToDoneFilteredQueries)
    ).toHaveBeenCalledWith('thread-1', 'unseen');
    expect(
      vi.mocked(restoreSoupEntityToDoneFilteredQueries)
    ).not.toHaveBeenCalledWith('channel-1');
  });

  it.each([undefined, 'thread-1'])(
    'restores the correct inbox row for a reaction (threadId: %s)',
    (threadId) => {
      mockHasSoupEntity.mockImplementation((id) => id === 'channel-1');
      seedQueryCache([createMockNotificationPage([])]);
      const reaction = createMockNotification({
        entity_type: 'channel',
        entity_id: 'channel-1',
        notification_event_type: 'channel_message_reaction',
        notification_metadata: {
          tag: 'channel_message_reaction',
          content: {
            messageId: 'message-1',
            threadId,
            messageContent: 'A message',
            emoji: '👍',
            channelType: 'public',
          },
        },
      });

      optimisticInsertNotification(reaction);

      const rootId = threadId ?? 'message-1';
      expect(
        vi.mocked(bumpSoupEntityNotifiedAt)
      ).toHaveBeenCalledExactlyOnceWith(rootId, reaction.created_at);
      expect(mockRefetchSoupEntity).toHaveBeenCalledExactlyOnceWith(
        rootId,
        'channelThread',
        { notified: true }
      );
      expect(
        vi.mocked(restoreSoupEntityToDoneFilteredQueries)
      ).toHaveBeenCalledExactlyOnceWith(rootId, 'unseen');
    }
  );

  it('should bump the updatedAt of an already-cached email thread', () => {
    mockHasSoupEntity.mockReturnValue(true);
    seedQueryCache([createMockNotificationPage([])]);

    const emailNotification = createMockNotification({
      entity_type: 'email_thread',
      entity_id: 'thread-1',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    optimisticInsertNotification(emailNotification);

    expect(mockOptimisticUpdateSoupItemUpdatedAt).toHaveBeenCalledWith(
      'thread-1',
      'emailThread',
      '2024-01-01T00:00:00.000Z'
    );
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('should refetch a brand-new soup entity that is not cached', () => {
    mockHasSoupEntity.mockReturnValue(false);
    seedQueryCache([createMockNotificationPage([])]);

    const emailNotification = createMockNotification({
      entity_type: 'email_thread',
      entity_id: 'thread-1',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    optimisticInsertNotification(emailNotification);

    expect(mockRefetchSoupEntity).toHaveBeenCalledWith(
      'thread-1',
      'emailThread',
      { notified: true }
    );
    expect(mockOptimisticUpdateSoupItemUpdatedAt).not.toHaveBeenCalled();
  });

  it('should skip the timestamp bump when a cached entity has no created_at', () => {
    mockHasSoupEntity.mockReturnValue(true);
    seedQueryCache([createMockNotificationPage([])]);

    const notificationWithoutCreatedAt = createMockNotification({
      created_at: undefined,
    });

    optimisticInsertNotification(notificationWithoutCreatedAt);

    expect(mockOptimisticUpdateSoupItemUpdatedAt).not.toHaveBeenCalled();
    expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
  });

  it('restores an agent-session row on an agent notification', () => {
    // An agent-session row marked done left the inbox; the next settled /
    // waiting-for-input notification has to bring it back like any other
    // notification-backed entity.
    mockHasSoupEntity.mockReturnValue(true);
    seedQueryCache([createMockNotificationPage([])]);

    const agentNotification = createMockNotification({
      entity_type: 'agent_session',
      entity_id: 'session-1',
      created_at: '2024-01-01T00:00:00.000Z',
      notification_event_type: 'agent_session_settled',
      notification_metadata: {
        tag: 'agent_session_settled',
        content: {
          sessionName: 'Fix mark done',
          excerpt: 'Done.',
        },
      },
    } as unknown as Partial<UnifiedNotification>);

    optimisticInsertNotification(agentNotification);

    expect(mockOptimisticUpdateSoupItemUpdatedAt).toHaveBeenCalledWith(
      'session-1',
      'agentSession',
      '2024-01-01T00:00:00.000Z'
    );
    expect(vi.mocked(bumpSoupEntityNotifiedAt)).toHaveBeenCalledWith(
      'session-1',
      '2024-01-01T00:00:00.000Z'
    );
    expect(
      vi.mocked(restoreSoupEntityToDoneFilteredQueries)
    ).toHaveBeenCalledWith('session-1', 'unseen');
  });

  it.each(['user', 'database'] as const)(
    'should skip soup update for %s entities',
    (entityType) => {
      seedQueryCache([createMockNotificationPage([])]);

      const userNotification = createMockNotification({
        entity_type: entityType,
        created_at: '2024-01-01T00:00:00.000Z',
      });

      optimisticInsertNotification(userNotification);

      expect(mockOptimisticUpdateSoupItemUpdatedAt).not.toHaveBeenCalled();
      expect(mockRefetchSoupEntity).not.toHaveBeenCalled();
    }
  );
});
