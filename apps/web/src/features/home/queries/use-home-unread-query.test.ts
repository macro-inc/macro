import { disposeChannelNotificationRefresh } from '@queries/channel/notification-refresh';
import { revalidateNotificationReaders } from '@queries/notification/revalidation';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { HomeUnreadPresenceDocument } from '@service-storage/graphql/generated/graphql';
import {
  CombinedError,
  createClient,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { Kind, print, visit } from 'graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, pipe, subscribe } from 'wonka';
import { useHomeUnreadQuery } from './use-home-unread-query';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  legacy: vi.fn(),
  legacyUnread: vi.fn(),
  notifiedSort: vi.fn(),
  userId: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.notifiedSort() }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: mocks.client,
}));
vi.mock('./use-home-query', () => ({ useHomeEntitiesQuery: mocks.legacy }));
vi.mock('@core/context/user', () => ({ useUserId: () => mocks.userId }));
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
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function setup(initialNotifiedSort = false) {
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
  const root = createRoot((dispose) => {
    cleanups.push(dispose, () => disposeChannelNotificationRefresh(client));
    const [enabled, setEnabled] = createSignal(false);
    const [notifiedSort, setNotifiedSort] = createSignal(initialNotifiedSort);
    mocks.notifiedSort.mockImplementation(notifiedSort);
    const [state, setState] = createSignal<'unseen' | 'seen' | 'done'>();
    const [pending, setPending] = createSignal(false);
    const [userId, setUserId] = createSignal<string | undefined>('viewer');
    mocks.userId.mockImplementation(userId);
    mocks.legacyUnread.mockReturnValue(true);
    mocks.legacy.mockReturnValue({
      query: {
        isLoading: false,
        get isPending() {
          return pending();
        },
        get data() {
          if (pending()) throw new Error('Read paused initial Soup query');
          if (enabled() && !notifiedSort())
            throw new Error('Read inactive full Soup query');
          return { entities: [] };
        },
      },
      hasUnreadEntity: mocks.legacyUnread,
      notificationSource: {
        withLocalState: (notification: { state: string }) =>
          state() ?? notification.state,
      },
      viewContext: () => ({
        tab: 'signal',
        facets: { read: ['unread'] },
        facetContext: {},
        userId: userId(),
        capabilities: {
          calendar: true,
          snippets: true,
          foreignEntities: true,
          notifiedSort: notifiedSort(),
        },
      }),
    });
    const unread = useHomeUnreadQuery(enabled);
    return {
      unread,
      setEnabled,
      setState,
      setNotifiedSort,
      setPending,
      setUserId,
    };
  });
  const queries = () => operations.filter((op) => op.kind === 'query');
  const respond = (state: 'UNSEEN' | 'SEEN', error?: CombinedError) =>
    network.next({
      operation: queries().at(-1)!,
      stale: false,
      hasNext: false,
      error,
      ...(!error
        ? {
            data: {
              user: {
                id: 'viewer',
                soup: {
                  items: [
                    {
                      __typename: 'GraphqlSoupChannel',
                      id: 'channel',
                      metadata: {
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                      },
                      unreadNotifications: [{ id: 'witness', state }],
                    },
                  ],
                },
              },
            },
          }
        : {}),
    });
  return { ...root, client, queries, respond };
}

describe('Home unread presence query', () => {
  it('does not read a paused initial legacy query', () => {
    const h = setup();
    h.setPending(true);
    expect(h.unread()).toBe(false);
    expect(mocks.legacyUnread).not.toHaveBeenCalled();
    h.setPending(false);
    expect(h.unread()).toBe(true);
  });

  it('selects bounded witnesses rather than historical notification content', () => {
    const fields: string[] = [];
    const edges: string[] = [];
    visit(HomeUnreadPresenceDocument, {
      Field(node) {
        fields.push(node.name.value);
        if (node.name.value !== 'notifications') return;
        edges.push(print(node));
        expect(
          node.arguments?.find((arg) => arg.name.value === 'limit')?.value
        ).toMatchObject({ kind: Kind.INT, value: '1' });
        expect(
          node.selectionSet?.selections.map((selection) =>
            selection.kind === Kind.FIELD ? selection.name.value : ''
          )
        ).toEqual(['id', 'state']);
      },
    });
    expect(edges).toHaveLength(2);
    expect(edges[0]).toContain('channelFeedOnly: true');
    expect(edges[1]).toContain('eventTypes: ["reminder"]');
    expect(fields).not.toContain('nextCursor');
    expect(fields).not.toContain('content');
    expect(fields).not.toContain('properties');
    expect(print(HomeUnreadPresenceDocument)).not.toContain('SoupItemFields');
  });

  it('switches rollout paths without enabling or reading full GraphQL Soup', async () => {
    const f = setup();
    expect(f.unread()).toBe(true);
    expect(f.queries()).toHaveLength(0);
    expect(mocks.legacy.mock.calls[0][1].enabled()).toBe(true);
    f.setEnabled(true);
    expect(mocks.legacy.mock.calls[0][1].enabled()).toBe(false);
    expect(f.unread()).toBe(false);
    await vi.waitFor(() => expect(f.queries()).toHaveLength(1));
    const op = f.queries()[0];
    expect(op.query).toEqual(HomeUnreadPresenceDocument);
    expect(op.variables?.input.initial).toMatchObject({
      limit: 100,
      expand: true,
      emailView: 'INBOX',
    });
    expect(JSON.stringify(op.variables)).toContain('UNSEEN');
    f.respond('UNSEEN');
    expect(f.unread()).toBe(true);
    f.setState('seen');
    expect(f.unread()).toBe(false);
    f.setState(undefined);
    expect(f.unread()).toBe(true);
    f.respond('SEEN');
    expect(f.unread()).toBe(false);
    f.setEnabled(false);
    expect(f.unread()).toBe(true);
    expect(getActiveGraphqlSoupRevalidations(f.client)).toEqual([]);
  });

  it('waits for the viewer before querying GraphQL', async () => {
    const f = setup();
    f.setUserId(undefined);
    // The legacy query waits for the viewer too, so it has no page yet.
    f.setPending(true);
    f.setEnabled(true);
    expect(f.unread()).toBe(false);
    expect(f.queries()).toHaveLength(0);
    f.setPending(false);
    f.setUserId('viewer');
    await vi.waitFor(() => expect(f.queries()).toHaveLength(1));
    expect(JSON.stringify(f.queries()[0].variables)).toContain(
      '"participant":"viewer"'
    );
  });

  it('keeps notified-at sorting on REST, including while GraphQL is disabled', async () => {
    const f = setup(true);
    expect(f.unread()).toBe(true);
    expect(f.queries()).toHaveLength(0);
    f.setEnabled(true);
    expect(f.unread()).toBe(true);
    expect(mocks.legacy.mock.calls[0][1].enabled()).toBe(true);
    expect(f.queries()).toHaveLength(0);
    expect(getActiveGraphqlSoupRevalidations(f.client)).toEqual([]);
    f.setNotifiedSort(false);
    expect(mocks.legacy.mock.calls[0][1].enabled()).toBe(false);
    await vi.waitFor(() => expect(f.queries()).toHaveLength(1));
    f.respond('UNSEEN');
    expect(f.unread()).toBe(true);
    f.setNotifiedSort(true);
    expect(f.unread()).toBe(true);
    expect(getActiveGraphqlSoupRevalidations(f.client)).toEqual([]);
  });

  it('refreshes the bounded edge after notification mutations and unregisters it on disposal', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const f = setup();
    f.setEnabled(true);
    await vi.waitFor(() => expect(f.queries()).toHaveLength(1));
    f.respond('UNSEEN');
    expect(getActiveGraphqlSoupRevalidations(f.client)).toEqual([
      {
        document: HomeUnreadPresenceDocument,
        variables: f.queries()[0].variables,
      },
    ]);
    const query = vi.spyOn(f.client, 'query');
    await revalidateNotificationReaders(f.client);
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(query).toHaveBeenCalledWith(
      HomeUnreadPresenceDocument,
      f.queries()[0].variables,
      { requestPolicy: 'network-only' }
    );
    f.respond('SEEN');
    expect(f.unread()).toBe(false);
    cleanups.splice(0).forEach((fn) => fn());
    expect(getActiveGraphqlSoupRevalidations(f.client)).toEqual([]);
  });

  it('retains cached evidence if a background refresh fails', async () => {
    const f = setup();
    f.setEnabled(true);
    await vi.waitFor(() => expect(f.queries()).toHaveLength(1));
    f.respond('UNSEEN');
    f.respond(
      'UNSEEN',
      new CombinedError({ networkError: new Error('offline') })
    );
    expect(f.unread()).toBe(true);
  });
});
