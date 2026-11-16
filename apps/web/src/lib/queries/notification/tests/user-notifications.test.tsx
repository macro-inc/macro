/**
 * @vitest-environment jsdom
 */

import type { UnifiedNotification } from '@notifications/types';
import { createEffect, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
} = vi.hoisted(() => ({
  createGraphqlMutationMock: vi.fn(),
  createGraphqlQueryMock: vi.fn(),
  executeGraphqlMutationMock: vi.fn(),
  graphqlCacheEnabledMock: vi.fn(() => true),
  refreshActiveSoupQueriesMock: vi.fn(async () => undefined),
}));

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
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

vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: graphqlCacheEnabledMock,
}));

vi.mock('../../client', () => ({ queryClient: {} }));

type GraphqlMutationInput = { notificationIds: string[] };
type GraphqlMutationOptions = {
  operation: string;
  onSuccess?: (data: unknown[], input: GraphqlMutationInput) => unknown;
};

beforeEach(() => {
  graphqlCacheEnabledMock.mockReturnValue(true);
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
      let error: Error | null = null;
      const mutateAsync = async (input: GraphqlMutationInput) => {
        try {
          const data = (await executeGraphqlMutationMock({
            ...input,
            operation: options.operation,
          })) as unknown[];
          await options.onSuccess?.(data, input);
          return { data: { updateNotifications: data } };
        } catch (cause) {
          error = cause instanceof Error ? cause : new Error(String(cause));
          return { error };
        }
      };

      return {
        isPending: false,
        get error() {
          return error;
        },
        mutate: vi.fn(),
        mutateAsync,
      };
    }
  );
});

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

function renderInRoot(Component: () => JSX.Element): () => void {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <Component />, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('useUserNotificationsQuery', () => {
  it('defers the full GraphQL feed until a data/status reader needs it, preserving pagination', async () => {
    createGraphqlQueryMock.mockClear();
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
    const dispose = renderInRoot(() => {
      query = useUserNotificationsQuery(() => ({ limit: 500 }));
      return <div />;
    });
    try {
      expect(query.isStarted).toBe(false);
      expect(createGraphqlQueryMock).not.toHaveBeenCalled();
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
    const dispose = renderInRoot(() => {
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

  it.each([true, false])(
    'reads active notifications from the GraphQL query (enabled=%s)',
    (enabled) => {
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

      const dispose = renderInRoot(() => {
        query = useUserNotificationsQuery(
          () => ({ limit: 500 }),
          () => ({ enabled })
        );
        return <div />;
      });

      expect(query?.data).toEqual([graphqlNotification]);
      const [queryArgs, queryOptions] =
        createGraphqlQueryMock.mock.calls.at(-1)!;
      expect(queryArgs()).toEqual({ limit: 500 });
      expect(queryOptions()).toEqual({ enabled });
      dispose();
    }
  );
});

describe('notification mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    graphqlCacheEnabledMock.mockReturnValue(true);
  });

  it.each([
    ['seen', useMarkNotificationsAsSeenMutation, 'MARK_SEEN'],
    ['done', useMarkNotificationsAsDoneMutation, 'MARK_DONE'],
  ] as const)(
    'marks notifications %s through GraphQL',
    async (_name, useMutation, operation) => {
      const updated = [{ id: 'n1' }];
      executeGraphqlMutationMock.mockResolvedValue(updated);

      let result: Promise<unknown> | undefined;
      const cleanup = renderInRoot(() => {
        const mutation = useMutation();
        result = mutation.mutateAsync({ notificationIds: ['n1', 'n3'] });
        return null;
      });

      await expect(result).resolves.toEqual(updated);
      expect(executeGraphqlMutationMock).toHaveBeenCalledWith({
        notificationIds: ['n1', 'n3'],
        operation,
      });
      // The normalized cache propagates the result; no Soup refetch needed.
      expect(refreshActiveSoupQueriesMock).not.toHaveBeenCalled();
      cleanup();
    }
  );

  it('refreshes active Soup queries when the GraphQL cache is unavailable', async () => {
    graphqlCacheEnabledMock.mockReturnValue(false);
    executeGraphqlMutationMock.mockResolvedValue([]);

    let mutatePromise: Promise<unknown> | undefined;
    const cleanup = renderInRoot(() => {
      const mutation = useMarkNotificationsAsSeenMutation();
      mutatePromise = mutation.mutateAsync({ notificationIds: ['n1'] });
      return null;
    });

    await mutatePromise;

    expect(refreshActiveSoupQueriesMock).toHaveBeenCalledOnce();
    cleanup();
  });

  it('rejects when the GraphQL mutation fails, without refreshing Soup', async () => {
    graphqlCacheEnabledMock.mockReturnValue(false);
    const failure = new Error('Connection failed');
    executeGraphqlMutationMock.mockRejectedValue(failure);

    let mutatePromise: Promise<unknown> | undefined;
    const cleanup = renderInRoot(() => {
      const mutation = useMarkNotificationsAsDoneMutation();
      mutatePromise = mutation.mutateAsync({ notificationIds: ['n1'] });
      return null;
    });

    await expect(mutatePromise).rejects.toBe(failure);
    expect(refreshActiveSoupQueriesMock).not.toHaveBeenCalled();
    cleanup();
  });
});
