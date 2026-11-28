import { mutationTraceParentOf } from '@app/lib/urql-solid/trace-parent-exchange';
import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import {
  optimisticContextOf,
  withOptimisticMutationDisposition,
} from '@graphql-cache/exchange/optimistic';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '@queries/soup/graphql/active-queries';
import { createClient, type Exchange, gql } from '@urql/core';
import { expect, it, onTestFinished, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import { saveCreatedEntityTags } from './created-entity-tags';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  host: vi.fn(),
  invalidateLegacy: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
  getGraphqlCacheHost: mocks.host,
}));
vi.mock('@queries/soup/cache', () => ({
  invalidateSoupEntity: mocks.invalidateLegacy,
}));

const list = gql`query TagList($input: SoupInput!) {
  user { soup(input: $input) { items { displayName } } }
}`;
const input = {
  entityType: 'PROJECT',
  entityId: 'folder',
  properties: [
    {
      propertyDefinitionId: 'tags',
      addOptionIds: ['selected'],
      removeOptionIds: [],
    },
  ],
} satisfies Parameters<typeof saveCreatedEntityTags>[0];

it('queues only the list the cache cannot keep current', async () => {
  const cached = { input: { initial: { limit: 3 } } };
  const uncached = { input: { initial: { limit: 4 } } };
  const committedQuery = vi.fn();
  const transport: Exchange = () => (ops) =>
    pipe(
      ops,
      map((operation) => {
        expect(mutationTraceParentOf(operation)).toBeDefined();
        const context = optimisticContextOf(operation);
        committedQuery(
          context?.revalidations.map(({ variablesJson }) =>
            JSON.parse(variablesJson)
          )
        );
        return withOptimisticMutationDisposition(
          { operation, data: {}, stale: false, hasNext: false },
          { kind: 'queued', transactionId: '42' }
        );
      })
    );
  const client = createClient({
    url: 'http://localhost/graphql',
    exchanges: [transport],
  });
  mocks.client.mockReturnValue(client);
  mocks.host.mockReturnValue({});
  onTestFinished(
    registerGraphqlSoupRevalidations(
      () => [{ document: list, variables: cached }],
      () => client,
      () => true
    )
  );
  onTestFinished(
    registerGraphqlSoupRevalidations(
      () => [{ document: list, variables: uncached }],
      () => client,
      () => false
    )
  );

  await saveCreatedEntityTags(input);

  expect(committedQuery).toHaveBeenCalledExactlyOnceWith([uncached]);
  expect(mocks.invalidateLegacy).not.toHaveBeenCalled();
});

it('lets the no-cache exchange read a mounted list once', async () => {
  let reads = 0;
  const seen: string[] = [];
  const exchange: Exchange = () => (ops) =>
    pipe(
      ops,
      filter((operation) => ['query', 'mutation'].includes(operation.kind)),
      map((operation) => {
        const data =
          operation.kind === 'mutation'
            ? {
                updateSoupEntityPropertyOptions: {
                  effect: {
                    __typename: 'SoupUpdated',
                    item: { __typename: 'GraphqlSoupProject', id: 'folder' },
                  },
                },
              }
            : {
                user: {
                  soup: {
                    items:
                      ++reads === 1 ? [] : [{ displayName: 'Tagged folder' }],
                  },
                },
              };
        return { operation, data, stale: false, hasNext: false };
      })
    );
  const client = createClient({
    url: 'http://localhost/graphql',
    exchanges: [networkRevalidationExchange(), exchange],
  });
  mocks.client.mockReturnValue(client);
  mocks.host.mockReturnValue(undefined);
  const refresh = vi.fn(async () => {});
  onTestFinished(
    registerActiveGraphqlSoupQuery({ isEnabled: () => true, refresh })
  );
  const subscription = client
    .query(list, { input: { initial: { limit: 8 } } })
    .subscribe(({ data }) => {
      const name = data?.user?.soup?.items?.[0]?.displayName;
      if (name) seen.push(name);
    });
  onTestFinished(() => subscription.unsubscribe());

  await saveCreatedEntityTags(input);

  expect(seen).toEqual(['Tagged folder']);
  expect(reads).toBe(2);
  expect(refresh).not.toHaveBeenCalled();
});
