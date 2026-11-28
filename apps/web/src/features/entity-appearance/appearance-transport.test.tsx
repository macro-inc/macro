import { networkRevalidationExchange } from '@graphql-cache/exchange/network-revalidation-exchange';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { queryClient } from '@queries/client';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { entityKeys } from '@queries/storage/keys';
import { render } from '@solidjs/testing-library';
import {
  type Client,
  CombinedError,
  createClient,
  gql,
  type Operation,
} from '@urql/core';
import { getOperationAST, print } from 'graphql';
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
    onMutationSettled: () => () => {},
    onCacheGenerationChanged: () => () => {},
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

it('reports an older server refusal and rolls back legacy document metadata', async () => {
  const document = {
    id: 'appearance-rollout-document',
    name: 'Example',
    ownerId: 'viewer',
    type: 'document',
    fileType: 'md',
  } as const;
  const queryKey = entityKeys.documentMetadata(document.id).queryKey;
  const legacy = { appearance: null };
  queryClient.setQueryData(queryKey, legacy);
  adapters.client = createClient({
    url: 'http://appearance.fixture/graphql',
    exchanges: [
      () => (operations) =>
        pipe(
          operations,
          filter((operation) => operation.kind === 'mutation'),
          map((operation) => ({
            operation,
            error: new CombinedError({
              graphQLErrors: [
                { message: 'Unknown type "SetEntityAppearanceInput"' },
              ],
            }),
            stale: false,
            hasNext: false,
          }))
        ),
    ],
  });
  const renderer = render(() => (
    <AppearanceDialog
      entity={document}
      isCurrent={() => true}
      userId="viewer"
      open={true}
      onOpenChange={vi.fn()}
    />
  ));
  try {
    const save = adapters.save;
    if (!save) throw new Error('Expected the appearance editor to mount');
    expect((await save({ color: 'green' })).isErr()).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toEqual(legacy);
    expect(adapters.rest).not.toHaveBeenCalled();
  } finally {
    renderer.unmount();
    queryClient.removeQueries({ queryKey, exact: true });
  }
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
      expect(write && print(write.query)).not.toMatch(/\bnotifications\b/);
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
