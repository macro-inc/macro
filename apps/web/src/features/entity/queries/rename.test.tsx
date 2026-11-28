import { withOptimisticMutationDisposition } from '@graphql-cache/exchange/optimistic';
import { optimisticResolversExchange } from '@graphql-cache/exchange/optimistic-resolvers';
import type { CacheHost } from '@graphql-cache/host/types';
import type { MutationSettlement } from '@graphql-cache/protocol';
import { entityOptimisticResolvers } from '@queries/entity-optimistic-resolvers';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
} from '@urql/core';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

const mocks = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  host: undefined as
    | Pick<CacheHost, 'onMutationSettled' | 'onCacheGenerationChanged'>
    | undefined,
  preview: vi.fn(),
  history: vi.fn(),
  soup: vi.fn(),
  toast: vi.fn(),
  renameDatabase: vi.fn(),
  renameAgentSession: vi.fn(),
}));
vi.mock('@block-database/queries/rename-database', () => ({
  renameDatabase: mocks.renameDatabase,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toast },
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_BEARER_TOKEN_AUTH: false,
}));
vi.mock('@queries/agent-session/entity-mutations', () => ({
  renameAgentSession: mocks.renameAgentSession,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return cache;
  },
}));
vi.mock('@queries/history/history', () => ({
  setHistoryItemName: mocks.history,
}));
vi.mock('@queries/preview', () => ({ setPreviewName: mocks.preview }));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: mocks.soup,
}));
vi.mock('@service-storage/client', () => ({
  ChannelTypeEnum: { DirectMessage: 'direct_message' },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getEntityGraphqlClient: () => mocks.client,
  getGraphqlCacheHost: () => mocks.host,
}));

import { authKeys } from '@queries/auth/keys';
import { callKeys } from '@queries/call/keys';
import { channelKeys } from '@queries/channel/keys';

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'viewer',
  useIsAuthenticated: () => () => true,
}));

import { registerNetworkRevalidation } from '@graphql-cache/exchange/network-revalidation-exchange';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { createRevalidatingClient } from '@queries/soup/graphql/revalidating-client.test-helpers';
import { SoupDocument } from '@service-storage/graphql/generated/graphql';
import {
  createBulkRenameDssEntityMutation,
  createRenameDssEntityMutation,
} from './rename';

let cache: QueryClient;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  cache.clear();
  vi.clearAllMocks();
});

it.each(['channel', 'call'] as const)(
  'does not leave a rejected queued %s rename in legacy caches',
  async (type) => {
    cache = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    cache.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    const listeners = new Set<(settlement: MutationSettlement) => void>();
    mocks.host = {
      onMutationSettled(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onCacheGenerationChanged: () => () => {},
    };
    const operations: Operation[] = [];
    const exchange: Exchange = () => (source) =>
      pipe(
        source,
        filter((operation) => operation.kind === 'mutation'),
        map((operation) => {
          operations.push(operation);
          return withOptimisticMutationDisposition(
            { operation, stale: false, hasNext: false },
            { kind: 'queued', transactionId: 'queued' }
          );
        })
      );
    mocks.client = createClient({
      url: 'http://test.invalid',
      exchanges: [
        optimisticResolversExchange(entityOptimisticResolvers),
        exchange,
      ],
    });
    const key =
      type === 'channel'
        ? channelKeys.directory('viewer').queryKey
        : callKeys.record('entity').queryKey;
    // A rejected channel rename rereads every viewer's in-memory directory.
    const invalidated = type === 'channel' ? channelKeys.directory._def : key;
    const original =
      type === 'channel'
        ? [{ id: 'entity', name: 'Before' }]
        : { id: 'entity', customName: 'Before' };
    cache.setQueryData(key, original);
    const invalidate = vi.spyOn(cache, 'invalidateQueries');
    let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
    dispose = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createRenameDssEntityMutation();
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    const result = await mutation.mutateAsync({
      entity: { id: 'entity', type, name: 'Before' },
      newName: 'Queued',
    });
    expect(result).toEqual({ success: true, queued: true });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.soup).not.toHaveBeenCalled();
    expect(cache.getQueryData(key)).toEqual(original);
    expect(mocks.toast).not.toHaveBeenCalled();
    const context = operations[0].context.optimisticMutation;
    if (!context) throw new Error('Missing optimistic context');
    for (const listener of [...listeners])
      listener({
        transactionId: 'queued',
        mutationUuid: context.uuid,
        status: 'permanently-failed',
        error: 'Denied',
      });
    expect(cache.getQueryData(key)).toEqual(original);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: invalidated });
    expect(listeners.size).toBe(0);
  }
);

it.each(['After', 'Before', ' Before '])(
  'renames a database to %s through its API only when changed',
  async (newName) => {
    cache = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    cache.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    mocks.client = createClient({
      url: 'http://test.invalid',
      exchanges: [],
    });
    mocks.renameDatabase.mockResolvedValue(ok(undefined));
    let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
    dispose = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createRenameDssEntityMutation();
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    const result = await mutation.mutateAsync({
      entity: {
        id: 'db-1',
        type: 'database',
        name: 'Before',
        grant: 'owner',
      },
      newName,
    });
    expect(result).toEqual({ success: true });
    if (newName.trim() === 'Before') {
      expect(mocks.renameDatabase).not.toHaveBeenCalled();
    } else {
      expect(mocks.renameDatabase).toHaveBeenCalledWith(
        mocks.client,
        'db-1',
        newName
      );
    }
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.soup).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  'rolls back only a failed agent session after a database rename (agent session success=%s)',
  async (success) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cache = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    cache.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    mocks.renameDatabase.mockResolvedValue(
      success ? err({ kind: 'unreachable' }) : ok(undefined)
    );
    if (success) mocks.renameAgentSession.mockResolvedValue(undefined);
    else mocks.renameAgentSession.mockRejectedValue(new Error('rename failed'));
    const rollback = vi.fn();
    mocks.soup.mockReturnValue({ rollback });
    let mutation!: ReturnType<typeof createBulkRenameDssEntityMutation>;
    dispose = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createBulkRenameDssEntityMutation();
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    expect(
      await mutation.mutateAsync([
        {
          entity: {
            id: 'db-1',
            type: 'database',
            name: 'Database before',
            grant: 'owner',
          },
          newName: 'Database after',
        },
        {
          entity: { id: 'session-1', type: 'agent_session', name: 'Before' },
          newName: 'After',
        },
      ])
    ).toEqual([{ success: !success }, { success }]);
    if (success) expect(rollback).not.toHaveBeenCalled();
    else {
      expect(rollback).toHaveBeenCalledOnce();
      expect(mocks.preview).toHaveBeenLastCalledWith({
        itemId: 'session-1',
        itemType: 'agent_session',
        name: 'Before',
      });
    }
    vi.restoreAllMocks();
  }
);

it('sends renames with one scope one at a time, in order, after their caller closes', async () => {
  cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  cache.setQueryData(authKeys.userInfo.queryKey, {
    id: 'viewer',
    authenticated: true,
  });
  mocks.client = createClient({ url: 'http://test.invalid', exchanges: [] });
  const settle: Array<() => void> = [];
  mocks.renameDatabase.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle.push(() => resolve(ok(undefined)));
      })
  );
  const mount = () => {
    let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
    const unmount = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createRenameDssEntityMutation(undefined, 'title:db-1');
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    return { mutation, unmount };
  };
  const renameTo = (
    mutation: ReturnType<typeof createRenameDssEntityMutation>,
    name: string,
    newName: string
  ) =>
    mutation.mutateAsync({
      entity: { id: 'db-1', type: 'database', name, grant: 'owner' },
      newName,
    });

  const closed = mount();
  const first = renameTo(closed.mutation, 'Before', 'Weekly');
  closed.unmount();
  // A rename its caller makes as it closes, then one from a new caller.
  const second = renameTo(closed.mutation, 'Weekly', 'Weekly sync');
  const reopened = mount();
  dispose = reopened.unmount;
  const third = renameTo(reopened.mutation, 'Weekly sync', 'Weekly agenda');

  await vi.waitFor(() => expect(settle).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settle).toHaveLength(1);
  settle[0]();
  await vi.waitFor(() => expect(settle).toHaveLength(2));
  settle[1]();
  await vi.waitFor(() => expect(settle).toHaveLength(3));
  settle[2]();
  await Promise.all([first, second, third]);
  expect(mocks.renameDatabase.mock.calls.map(([, , name]) => name)).toEqual([
    'Weekly',
    'Weekly sync',
    'Weekly agenda',
  ]);
});

it('reads a mounted list once after a rename without the cache', async () => {
  cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  cache.setQueryData(authKeys.userInfo.queryKey, {
    id: 'viewer',
    authenticated: true,
  });
  mocks.host = undefined;
  const server = createRevalidatingClient(() => ({
    renameEntities: {
      results: [{ __typename: 'GraphqlMutationSuccess' }],
    },
  }));
  mocks.client = server.client;
  const variables = { input: { initial: { limit: 50 } } };
  const list = await server.mount(SoupDocument, variables);
  // Registered for refreshes as soup/items.ts does.
  const unregister = registerActiveGraphqlSoupQuery({
    isEnabled: () => true,
    refresh: async () => {
      await server.client
        .query(SoupDocument, variables, { requestPolicy: 'network-only' })
        .toPromise();
    },
  });
  let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
  dispose = render(
    () => (
      <QueryClientProvider client={cache}>
        {(() => {
          mutation = createRenameDssEntityMutation();
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.createElement('div')
  );

  await mutation.mutateAsync({
    entity: { id: 'doc-1', type: 'document', name: 'Before' },
    newName: 'After',
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // The mount, then the client's read before the write settled.
  expect(server.reads('Soup')).toBe(2);
  unregister();
  list.unsubscribe();
});

it('reads each mounted list again after a rename whose exchange read failed', async () => {
  cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  cache.setQueryData(authKeys.userInfo.queryKey, {
    id: 'viewer',
    authenticated: true,
  });
  mocks.host = undefined;
  const server = createRevalidatingClient(() => ({
    renameEntities: {
      results: [{ __typename: 'GraphqlMutationSuccess' }],
    },
  }));
  mocks.client = server.client;
  // A mounted list whose read after the write fails.
  const unregisterFailing = registerNetworkRevalidation(server.client, {
    active: () => true,
    gone: () => false,
    revalidate: () => Promise.reject(new Error('offline')),
  });
  const refresh = vi.fn(async () => {});
  const unregister = registerActiveGraphqlSoupQuery({
    isEnabled: () => true,
    refresh,
  });
  let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
  dispose = render(
    () => (
      <QueryClientProvider client={cache}>
        {(() => {
          mutation = createRenameDssEntityMutation();
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.createElement('div')
  );

  await mutation.mutateAsync({
    entity: { id: 'doc-1', type: 'document', name: 'Before' },
    newName: 'After',
  });

  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  unregister();
  unregisterFailing();
});

it.each([
  ['committed', 200],
  ['failed', 503],
])(
  'reports a rename %s when its only error is in its returned rows, HTTP %i',
  async (outcome, status) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cache = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    cache.setQueryData(authKeys.userInfo.queryKey, {
      id: 'viewer',
      authenticated: true,
    });
    mocks.host = undefined;
    mocks.soup.mockReturnValue({ rollback: vi.fn() });
    const error = new CombinedError({
      graphQLErrors: [
        {
          message: 'A changed item could not be read back',
          path: ['renameEntities', 'results', 0, 'effects', 0, 'item'],
        },
      ],
      response: new Response(null, { status }),
    });
    const exchange: Exchange = () => (source) =>
      pipe(
        source,
        filter((operation) => operation.kind === 'mutation'),
        map((operation) => ({
          operation,
          stale: false,
          hasNext: false,
          data: {
            renameEntities: {
              results: [{ __typename: 'GraphqlMutationSuccess', effects: [] }],
            },
          },
          error,
        }))
      );
    mocks.client = createClient({
      url: 'http://test.invalid',
      exchanges: [exchange],
    });
    let mutation!: ReturnType<typeof createRenameDssEntityMutation>;
    dispose = render(
      () => (
        <QueryClientProvider client={cache}>
          {(() => {
            mutation = createRenameDssEntityMutation();
            return null;
          })()}
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    const renamed = mutation.mutateAsync({
      entity: { id: 'document-1', type: 'document', name: 'Before' },
      newName: 'After',
    });
    await expect(renamed).resolves.toEqual({
      success: outcome === 'committed',
    });
    vi.restoreAllMocks();
  }
);
