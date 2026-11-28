import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { render } from '@solidjs/testing-library';
import { type Client, createClient, gql, type Operation } from '@urql/core';
import { getOperationAST } from 'graphql';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';
import { AppearanceDialog } from './appearance-dialog';
import type { AppearanceEditorProps } from './views/appearance-editor';

const adapters = vi.hoisted(() => ({
  rest: vi.fn(async () => ok(undefined)),
  client: undefined as Client | undefined,
  cached: false,
  typename: 'GraphqlSoupDocument',
  save: undefined as AppearanceEditorProps['save'] | undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: vi.fn() }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  hydrateSoupEntity: vi.fn(),
  optimisticUpdateSoupEntity: vi.fn(),
}));
vi.mock('@service-storage/entity-appearance', () => ({
  setEntityAppearance: adapters.rest,
  setOtherEntityAppearance: adapters.rest,
}));
vi.mock('@service-storage/graphql-soup', () => {
  const host = {
    disabled: false,
    readRecordsByKeys: async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [
        {
          recordKey: `${adapters.typename}:entity`,
          record: {
            __typename: adapters.typename,
            id: 'entity',
            appearance: null,
          },
        },
      ],
    }),
    writeQuery: async () => undefined,
  };
  return {
    acknowledgeGraphqlRestWrite: vi.fn(),
    getEntityGraphqlClient: () => adapters.client,
    getGraphqlCacheHost: () => (adapters.cached ? host : undefined),
    getGraphqlSoupCacheHost: () => (adapters.cached ? host : undefined),
    getGraphqlSoupClient: () => adapters.client,
  };
});
vi.mock('./views/appearance-editor', () => ({
  AppearanceEditor: (props: AppearanceEditorProps) => {
    adapters.save = props.save;
    return null;
  },
}));

const list = gql`
  query AppearanceSoup($input: SoupInput!) {
    user {
      id
      soup(input: $input) {
        items {
          __typename
          id
          ... on GraphqlSoupDocument { appearance }
          ... on GraphqlSoupInitiative { appearance }
        }
      }
    }
  }
`;

afterEach(() => {
  adapters.client = undefined;
  adapters.cached = false;
  adapters.save = undefined;
  vi.clearAllMocks();
});

it.each(
  (['document', 'initiative'] as const).flatMap((type) =>
    [8, 16].flatMap((count) => [
      { type, count, cached: false },
      { type, count, cached: true },
    ])
  )
)(
  'writes $type through GraphQL with $count mounted lists and cache=$cached',
  async ({ type, count, cached }) => {
    adapters.typename =
      type === 'document' ? 'GraphqlSoupDocument' : 'GraphqlSoupInitiative';
    const appearance = {
      icon: { kind: 'emoji', value: '🌿' },
      color: 'green',
    } as const;
    const data = {
      setEntityAppearance: {
        results: [
          {
            __typename: 'GraphqlMutationSuccess',
            effects: [
              {
                __typename: 'SoupUpdated',
                item: {
                  __typename: adapters.typename,
                  id: 'entity',
                  appearance,
                },
              },
            ],
          },
        ],
      },
    };
    const requests: Operation[] = [];
    const client = createClient({
      url: 'http://appearance.fixture/graphql',
      exchanges: [
        networkRevalidationExchange(() => !cached),
        () => (operations) =>
          pipe(
            operations,
            filter((operation) => operation.kind !== 'teardown'),
            map((operation) => {
              requests.push(operation);
              return {
                operation,
                data: operation.kind === 'mutation' ? data : {},
                stale: false,
                hasNext: false,
              };
            })
          ),
      ],
    });
    adapters.cached = cached;
    adapters.client = client;
    const identity = { id: 'entity', name: 'Example', ownerId: 'viewer' };
    const renderer = render(() => (
      <AppearanceDialog
        entity={
          type === 'document'
            ? { ...identity, type, fileType: 'md' }
            : { ...identity, type }
        }
        isCurrent={() => true}
        userId="viewer"
        open={true}
        onOpenChange={vi.fn()}
      />
    ));

    const readers = [];
    for (let i = 0; i < count; i++) {
      const variables = {
        input: {
          initial: {
            limit: 50,
            filters: { documentFilter: { literal: { id: `document-${i}` } } },
          },
        },
      };
      const loaded = Promise.withResolvers<void>();
      const subscription = client
        .query(list, variables)
        .subscribe(() => loaded.resolve());
      await loaded.promise;
      // The old editor called these readers itself. The new editor uses the
      // exchange, which sees the same mounted queries.
      const unregister = registerActiveGraphqlSoupQuery({
        isEnabled: () => true,
        cacheMaintained: () => cached,
        refresh: async () => {
          await client
            .query(list, variables, { requestPolicy: 'network-only' })
            .toPromise();
        },
      });
      readers.push(() => {
        unregister();
        subscription.unsubscribe();
      });
    }
    try {
      const save = adapters.save;
      if (!save) throw new Error('Expected the appearance editor to mount');
      expect((await save(appearance)).isOk()).toBe(true);
      const writes = requests.filter((op) => op.kind === 'mutation');
      expect({
        rest: adapters.rest.mock.calls.length,
        graphql: writes.length,
        reads: requests.filter((op) => op.kind === 'query').length - count,
      }).toEqual({ rest: 0, graphql: 1, reads: cached ? 0 : count });
      const [write] = writes;
      expect(write && getOperationAST(write.query)?.name?.value).toBe(
        'SetEntityAppearance'
      );
      expect(write?.variables).toEqual({
        input: {
          entity: {
            type: type === 'document' ? 'DOCUMENT' : 'INITIATIVE',
            id: 'entity',
          },
          icon: { emoji: '🌿' },
          color: 'GREEN',
        },
      });
    } finally {
      readers.forEach((dispose) => dispose());
      renderer.unmount();
    }
  }
);
