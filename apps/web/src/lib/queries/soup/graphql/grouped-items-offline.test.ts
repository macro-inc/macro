import {
  type Client,
  CombinedError,
  type GraphQLRequest,
  makeOperation,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

const mocks = vi.hoisted(() => ({ client: vi.fn(), local: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));
vi.mock('@app/lib/graphql-cache', () => ({
  normalizedCacheResultMetadata: () => undefined,
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: () => ({}),
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
  mapGraphqlSoupItem: (item: unknown) => item,
}));
vi.mock('./items', () => ({ createGraphqlSoupAstItemsQuery: mocks.local }));
vi.mock('./active-queries', () => ({
  registerGraphqlSoupRevalidations: () => () => {},
}));
vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));
vi.mock('../grouped/api', () => ({
  makeGroupComparator: () => () => 0,
  resolveGroupMetaForKey: () => undefined,
}));
vi.mock('../grouped/mail-date-groups', () => ({
  groupCachedMailByDate: (data: unknown) => data,
}));

import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import {
  createGraphqlGroupedSoupAstItemsQuery,
  type GraphqlGroupedSoupAstItemsQueryArgs,
} from './grouped-items';

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    userId: 'viewer',
    authenticated: true,
  });
});

function fixture() {
  const executions: Array<(result: Partial<OperationResult>) => void> = [];
  mocks.client.mockReturnValue({
    executeQuery(request: GraphQLRequest, context: Partial<OperationContext>) {
      const subject = makeSubject<OperationResult>();
      const operation = makeOperation('query', request, {
        url: 'https://test.invalid/graphql',
        requestPolicy: 'cache-and-network',
        ...context,
      });
      executions.push((result) =>
        subject.next({ operation, stale: false, hasNext: false, ...result })
      );
      return subject.source;
    },
  } as unknown as Client);
  mocks.local.mockReturnValue({ data: () => undefined });
  const [args, setArgs] = createSignal<GraphqlGroupedSoupAstItemsQueryArgs>({
    params: { limit: 100 },
    body: {},
    groupBy: { type: 'property', propertyDefinitionId: 'priority' },
  });
  const root = createRoot((dispose) => ({
    dispose,
    query: createGraphqlGroupedSoupAstItemsQuery(args, () => ({
      enabled: true,
      // Retained data must not be mistaken for a hit for changed filters.
      keepPreviousData: true,
    })),
  }));
  const publish = (result: Partial<OperationResult>) =>
    executions[executions.length - 1](result);
  return {
    ...root,
    setArgs,
    fail: (error: CombinedError) => publish({ error }),
    cache(empty = false, error?: CombinedError) {
      publish({
        stale: true,
        error,
        data: {
          user: {
            id: 'viewer',
            groupSoup: {
              bins: empty
                ? []
                : [
                    {
                      key: 'high',
                      totalCount: 1,
                      nextCursor: null,
                      items: [
                        {
                          __typename: 'GraphqlSoupDocument',
                          id: 'task',
                          type: 'document',
                        },
                      ],
                    },
                  ],
            },
          },
        },
      });
    },
  };
}

const disconnected = () =>
  new CombinedError({ networkError: new TypeError('Failed to fetch') });

describe('grouped Soup transport failures', () => {
  it.each([false, true])(
    'retains a usable cached page (empty=%s) after a failed refresh',
    async (empty) => {
      const f = fixture();
      try {
        await vi.waitFor(() => f.cache(empty));
        const cached = f.query.data();
        expect(cached?.entities.length).toBe(empty ? 0 : 1);
        f.fail(disconnected());
        expect(f.query.data()).toBe(cached);
        expect(f.query.error()).toBeUndefined();
        expect(f.query.isLoading()).toBe(false);
      } finally {
        f.dispose();
      }
    }
  );

  it('surfaces an initial failure until a delayed cache hit arrives', async () => {
    const f = fixture();
    try {
      const error = disconnected();
      await vi.waitFor(() => f.fail(error));
      expect(f.query.error()).toBe(error);
      expect(f.query.data()).toBeUndefined();
      f.cache(false, error);
      expect(f.query.data()?.entities).toHaveLength(1);
      expect(f.query.error()).toBeUndefined();
    } finally {
      f.dispose();
    }
  });

  it('does not hide a new filter failure using previous-query data', async () => {
    const f = fixture();
    try {
      await vi.waitFor(() => f.cache());
      const error = disconnected();
      f.setArgs((args) => ({ ...args, params: { limit: 50 } }));
      await vi.waitFor(() => f.fail(error));
      expect(f.query.error()).toBe(error);
      f.cache();
      f.fail(error);
      expect(f.query.error()).toBeUndefined();
    } finally {
      f.dispose();
    }
  });

  it.each([
    new CombinedError({ graphQLErrors: ['Access denied'] }),
    new CombinedError({
      graphQLErrors: ['Resolver failed'],
      networkError: new TypeError('Failed to fetch'),
    }),
    ...[401, 403, 500].map(
      (status) =>
        new CombinedError({
          networkError: new Error('HTTP error'),
          response: new Response(null, { status }),
        })
    ),
  ])('preserves server errors even with cached data: %s', async (error) => {
    const f = fixture();
    try {
      await vi.waitFor(() => f.cache());
      f.fail(error);
      expect(f.query.error()).toBe(error);
    } finally {
      f.dispose();
    }
  });
});
