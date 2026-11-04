import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { disposeChannelNotificationRefresh } from '@queries/channel/notification-refresh';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import {
  EntityNotificationsDocument,
  type SoupEntityInput,
} from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation, type OperationResult } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeSubject, pipe, subscribe } from 'wonka';
import { useEntityNotifications } from '../entity-notifications';
import { revalidateNotificationReaders } from '../revalidation';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  userId: vi.fn(() => 'viewer'),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => mocks.userId,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const cleanups: (() => void)[] = [];
beforeEach(() => mocks.userId.mockReturnValue('viewer'));
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});

it('reuses cached entity notifications and observes their state changes without a network read', async () => {
  let affected!: (keys: number[]) => void;
  let operationKey = 0;
  const networkOperations: Operation[] = [];
  const watchQuery = vi.fn().mockImplementation(async (args) => {
    operationKey = args.opKey;
    if (args.since !== undefined) {
      return {
        kind: 'patch',
        revision: parseCacheRevision('2'),
        patches: [
          {
            path: ['user', 'soupEntity', 'notifications', 0, 'state'],
            value: 'SEEN',
          },
        ],
      };
    }
    return {
      kind: 'hit',
      revision: parseCacheRevision('1'),
      data: {
        user: {
          id: 'viewer',
          soupEntity: {
            __typename: 'GraphqlSoupDocument',
            id: 'favorite',
            notifications: [{ id: 'notification', state: 'UNSEEN' }],
          },
        },
      },
    };
  });
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      normalizedCacheExchange({
        ...createNoopCacheHost(),
        disabled: false,
        watchQuery,
        onOpsAffected: (callback) => {
          affected = callback;
          return () => {};
        },
      }),
      () => (operations) => {
        pipe(
          operations,
          subscribe((operation) => networkOperations.push(operation))
        );
        return makeSubject<OperationResult>().source;
      },
    ],
  });
  mocks.client.mockReturnValue(client);
  cleanups.push(() => disposeChannelNotificationRefresh(client));
  const notifications = createRoot((dispose) => {
    cleanups.push(dispose);
    return useEntityNotifications(() => ({
      entityType: 'DOCUMENT',
      entityId: 'favorite',
    }));
  });
  await vi.waitFor(() => expect(notifications()[0]?.state).toBe('UNSEEN'));
  expect(
    networkOperations.filter((operation) => operation.kind === 'query')
  ).toHaveLength(0);
  affected([operationKey]);
  await vi.waitFor(() => expect(notifications()[0]?.state).toBe('SEEN'));
});

it('loads only the requested entity, revalidates its edge, and clears obsolete viewer data', async () => {
  const operations: Operation[] = [];
  const network = makeSubject<OperationResult>();
  const client = createClient({
    url: 'http://test/graphql',
    exchanges: [
      () => (source) => {
        pipe(
          source,
          subscribe((operation) => operations.push(operation))
        );
        return network.source;
      },
    ],
  });
  mocks.client.mockReturnValue(client);
  cleanups.push(() => disposeChannelNotificationRefresh(client));
  const [input, setInput] = createSignal<SoupEntityInput>();
  const [viewerId, setViewerId] = createSignal('viewer');
  mocks.userId.mockImplementation(viewerId);
  const notifications = createRoot((dispose) => {
    cleanups.push(dispose);
    return useEntityNotifications(input);
  });
  const queries = () =>
    operations.filter((operation) => operation.kind === 'query');
  expect(queries()).toHaveLength(0);
  setInput({ entityType: 'FOREIGN_ENTITY', entityId: 'favorite-review' });
  await vi.waitFor(() => expect(queries()).toHaveLength(1));
  expect(queries()[0].query).toEqual(EntityNotificationsDocument);
  expect(queries()[0].variables).toEqual({
    input: { entityType: 'FOREIGN_ENTITY', entityId: 'favorite-review' },
  });
  const data = {
    user: {
      id: 'viewer',
      soupEntity: {
        __typename: 'GraphqlSoupForeignEntity',
        id: 'favorite-review',
        notifications: [{ id: 'notification', state: 'UNSEEN' }],
      },
    },
  };
  network.next({ operation: queries()[0], stale: false, hasNext: false, data });
  await vi.waitFor(() => expect(notifications()[0]?.id).toBe('notification'));
  expect(getActiveGraphqlSoupRevalidations(client)).toEqual([
    { document: EntityNotificationsDocument, variables: { input: input() } },
  ]);
  await revalidateNotificationReaders(client);
  await vi.waitFor(() => expect(queries()).toHaveLength(2));
  network.next({ operation: queries()[1], stale: false, hasNext: false, data });
  setViewerId('next-viewer');
  expect(notifications()).toEqual([]);
  await vi.waitFor(() => expect(queries()).toHaveLength(3));
  expect(queries()[2].context.requestPolicy).toBe('network-only');
  network.next({
    operation: queries()[2],
    stale: false,
    hasNext: false,
    data: { user: { ...data.user, id: 'next-viewer' } },
  });
  await vi.waitFor(() => expect(notifications()[0]?.id).toBe('notification'));
  setInput(undefined);
  expect(notifications()).toEqual([]);
  expect(getActiveGraphqlSoupRevalidations(client)).toEqual([]);
});
