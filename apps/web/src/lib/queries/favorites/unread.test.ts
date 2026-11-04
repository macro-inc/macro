import { disposeChannelNotificationRefresh } from '@queries/channel/notification-refresh';
import { revalidateNotificationReaders } from '@queries/notification/revalidation';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { FavoriteUnreadPresenceDocument } from '@service-storage/graphql/generated/graphql';
import { createClient, type Operation, type OperationResult } from '@urql/core';
import { Kind, visit } from 'graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, pipe, subscribe } from 'wonka';
import { hasFavoriteUnreadWitness, useFavoriteUnreadPresence } from './unread';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  userId: vi.fn<() => string | undefined>(() => 'viewer'),
  authenticated: vi.fn(() => true),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => mocks.userId,
  useIsAuthenticated: () => mocks.authenticated,
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
beforeEach(() => {
  mocks.userId.mockReturnValue('viewer');
  mocks.authenticated.mockReturnValue(true);
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});

describe('favorite unread presence', () => {
  it('uses a bounded witness without global feed content and respects read rollback', () => {
    const [override, setOverride] = createSignal<'seen' | 'done' | undefined>();
    const items = [
      {
        __typename: 'GraphqlSoupDocument' as const,
        id: 'favorite',
        unreadNotifications: [{ id: 'witness', state: 'UNSEEN' as const }],
      },
    ];
    const source = {
      withLocalState: ({
        state,
      }: {
        id: string;
        state: 'unseen' | 'seen' | 'done';
      }) => override() ?? state,
    };
    const favorite = { entityId: 'favorite', entityType: 'document' as const };
    expect(hasFavoriteUnreadWitness(items, favorite, source)).toBe(true);
    setOverride('seen');
    expect(hasFavoriteUnreadWitness(items, favorite, source)).toBe(false);
    setOverride('done');
    expect(hasFavoriteUnreadWitness(items, favorite, source)).toBe(false);
    setOverride(undefined);
    expect(hasFavoriteUnreadWitness(items, favorite, source)).toBe(true);
    expect(
      hasFavoriteUnreadWitness(
        items,
        { ...favorite, entityId: 'other' },
        source
      )
    ).toBe(false);
  });

  it('fetches all favorite pages once across rows and revalidates their bounded edges', async () => {
    const operations: Operation[] = [];
    const network = makeSubject<OperationResult>();
    const client = createClient({
      url: 'http://test/graphql',
      exchanges: [
        () => (ops) => {
          pipe(
            ops,
            subscribe((op) => operations.push(op))
          );
          return network.source;
        },
      ],
    });
    mocks.client.mockReturnValue(client);
    cleanups.push(() => disposeChannelNotificationRefresh(client));
    const rows = createRoot((dispose) => {
      cleanups.push(dispose);
      return [useFavoriteUnreadPresence(), useFavoriteUnreadPresence()];
    });
    const queries = () => operations.filter((op) => op.kind === 'query');
    await vi.waitFor(() => expect(queries()).toHaveLength(1));
    expect(queries()[0].variables).toMatchObject({
      input: {
        initial: {
          limit: 100,
          sortMethod: 'UPDATED_AT',
          filters: { favoritesOnly: true },
        },
      },
    });
    const respond = (
      index: number,
      id: string,
      nextCursor: string | null,
      notificationId = `notification-${id}`
    ) =>
      network.next({
        operation: queries()[index],
        stale: false,
        hasNext: false,
        data: {
          user: {
            id: 'viewer',
            soup: {
              nextCursor,
              items: [
                {
                  __typename: 'GraphqlSoupDocument',
                  id,
                  unreadNotifications: [
                    { id: notificationId, state: 'UNSEEN' },
                  ],
                },
              ],
            },
          },
        },
      });
    respond(0, 'first', 'more');
    await vi.waitFor(() => expect(queries()).toHaveLength(2));
    expect(queries()[1].variables).toMatchObject({
      input: { continuation: { cursor: 'more' } },
    });
    respond(1, 'second', null);
    await vi.waitFor(() =>
      expect(rows[0]().map((item) => item.id)).toEqual(['first', 'second'])
    );
    expect(rows[1]()).toEqual(rows[0]());
    const active = getActiveGraphqlSoupRevalidations(client);
    expect(active).toHaveLength(2);
    expect(
      active.every(
        ({ document }) => document === FavoriteUnreadPresenceDocument
      )
    ).toBe(true);
    await revalidateNotificationReaders(client);
    // The channel refresh coordinator owns these active readers.
    await vi.waitFor(() => expect(queries().length).toBeGreaterThan(2));
    const initialRefreshIndex = queries().findIndex(
      (operation, index) => index > 1 && operation.variables?.input?.initial
    );
    expect(initialRefreshIndex).toBeGreaterThan(1);
    respond(initialRefreshIndex, 'first', 'more', 'next-unread-notification');
    const favorite = { entityId: 'first', entityType: 'document' as const };
    const source = {
      withLocalState: ({ id }: { id: string }) =>
        id === 'notification-first' ? ('seen' as const) : ('unseen' as const),
    };
    await vi.waitFor(() =>
      expect(hasFavoriteUnreadWitness(rows[0](), favorite, source)).toBe(true)
    );
  });

  it('clears witnesses when the viewer changes after signing in', async () => {
    const [viewerId, setViewerId] = createSignal<string>();
    mocks.userId.mockImplementation(viewerId);
    const operations: Operation[] = [];
    const network = makeSubject<OperationResult>();
    const client = createClient({
      url: 'http://test/graphql',
      exchanges: [
        () => (ops) => {
          pipe(
            ops,
            subscribe((op) => operations.push(op))
          );
          return network.source;
        },
      ],
    });
    mocks.client.mockReturnValue(client);
    cleanups.push(() => disposeChannelNotificationRefresh(client));
    const items = createRoot((dispose) => {
      cleanups.push(dispose);
      return useFavoriteUnreadPresence();
    });
    const queries = () => operations.filter((op) => op.kind === 'query');
    expect(queries()).toHaveLength(0);
    setViewerId('viewer');
    await vi.waitFor(() => expect(queries()).toHaveLength(1));
    const data = {
      user: {
        id: 'viewer',
        soup: {
          nextCursor: null,
          items: [
            {
              __typename: 'GraphqlSoupDocument',
              id: 'favorite',
              unreadNotifications: [{ id: 'witness', state: 'UNSEEN' }],
            },
          ],
        },
      },
    };
    network.next({
      operation: queries()[0],
      stale: false,
      hasNext: false,
      data,
    });
    await vi.waitFor(() =>
      expect(items().map((item) => item.id)).toEqual(['favorite'])
    );
    setViewerId('next-viewer');
    expect(items()).toEqual([]);
    await vi.waitFor(() => expect(queries()).toHaveLength(2));
    network.next({
      operation: queries()[1],
      stale: false,
      hasNext: false,
      data,
    });
    expect(items()).toEqual([]);
  });

  it('requests only one unseen notification for each favorite', () => {
    const fields: string[] = [];
    visit(FavoriteUnreadPresenceDocument, {
      Field(node) {
        fields.push(node.name.value);
      },
      Argument(node) {
        if (node.name.value === 'limit')
          expect(node.value).toMatchObject({ kind: Kind.INT, value: '1' });
      },
    });
    expect(fields).toContain('nextCursor');
    expect(fields).not.toContain('content');
    expect(fields).not.toContain('properties');
  });
});
