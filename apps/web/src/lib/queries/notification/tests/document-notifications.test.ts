import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Accessor, createRoot, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentNotificationsQuery,
  useDocumentNotificationsQuery,
} from '../graphql/document-notifications';

type Row = {
  id: string;
  entityId: string;
  targetEntityType: string;
  state: string;
  createdAt: string;
};

const mocks = vi.hoisted(() => ({
  createQuery: vi.fn(),
  refetch: vi.fn(),
  listeners: new Set<(patch: unknown) => void>(),
  cacheHost: vi.fn(() => true),
  client: { query: vi.fn() },
}));
vi.mock('@app/lib/urql-solid', () => ({ createUrqlQuery: mocks.createQuery }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  hasGraphqlCacheHost: mocks.cacheHost,
  subscribeGraphqlSoupReconnected: () => () => {},
  mapGraphqlNotification: (row: Row) => ({
    id: row.id,
    entity_id: row.entityId,
    entity_type: row.targetEntityType.toLowerCase(),
    state: row.state.toLowerCase(),
    created_at: row.createdAt,
  }),
}));
vi.mock('@service-storage/graphql-update-notifications', () => ({}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: (
    listener: (patch: unknown) => void
  ) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));

let dispose: () => void;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
  mocks.cacheHost.mockReturnValue(true);
});

const row = (
  id: string,
  createdAt: string,
  overrides: Partial<Row> = {}
): Row => ({
  id,
  entityId: 'doc',
  targetEntityType: 'DOCUMENT',
  state: 'UNSEEN',
  createdAt,
  ...overrides,
});

function setup(
  shown: { id: string }[] = [],
  enabled: Accessor<boolean> = () => true
) {
  mocks.refetch.mockResolvedValue(undefined);
  mocks.createQuery.mockReturnValue({
    refetch: mocks.refetch,
    isEnabled: true,
    data: shown,
  });
  createRoot((cleanup) => {
    dispose = cleanup;
    createDocumentNotificationsQuery('doc', enabled);
  });
  const options = mocks.createQuery.mock.calls[0][0]();
  const deliver = (patch: object) => {
    for (const listener of mocks.listeners)
      listener(patch as GraphqlNotificationPatch);
  };
  const notification = (
    kind: 'GraphqlNewNotification' | 'GraphqlUpdatedNotification',
    id: string,
    entityId = 'doc'
  ) => deliver({ __typename: kind, notification: { id, entityId } });
  return { options, deliver, notification };
}

describe('open document notifications', () => {
  it('reads only this document, with the unfiltered edge, as a user-visible request', () => {
    const { options } = setup();
    expect(options.query).toBe(SoupNotificationsDocument);
    expect(options.client).toBe(mocks.client);
    expect(options.variables.input.initial.limit).toBe(1);
    expect(options.variables.input.initial.filters.documentFilter).toEqual({
      literal: { id: 'doc' },
    });
    expect(options.requestPolicy).toBe('cache-and-network');
    expect(options.context).toBeUndefined();
  });

  it('keeps the document’s own active notifications, newest first', () => {
    const { options } = setup();
    const data = {
      user: {
        soup: {
          items: [
            {
              id: 'doc',
              notifications: [
                row('older', '2026-01-01T00:00:00.000Z', { state: 'SEEN' }),
                row('newer', '2026-01-02T00:00:00.000Z'),
                row('done', '2026-01-03T00:00:00.000Z', { state: 'DONE' }),
                row('mention', '2026-01-04T00:00:00.000Z', {
                  entityId: 'channel',
                  targetEntityType: 'CHANNEL',
                }),
                row('other-type', '2026-01-05T00:00:00.000Z', {
                  targetEntityType: 'CHAT',
                }),
              ],
            },
          ],
        },
      },
    } as unknown as SoupNotificationsQuery;
    expect(options.select(data).map(({ id }: { id: string }) => id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('reads again when a notification arrives for this document only', async () => {
    const f = setup();
    f.notification('GraphqlNewNotification', 'n', 'another-doc');
    expect(mocks.refetch).not.toHaveBeenCalled();
    f.notification('GraphqlNewNotification', 'n');
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  });

  it('leaves a cached state change of a shown notification to the cache', async () => {
    const f = setup([{ id: 'shown' }]);
    f.notification('GraphqlUpdatedNotification', 'shown');
    expect(mocks.refetch).not.toHaveBeenCalled();
    // Marked not done again: the edge that dropped it has to be read.
    f.notification('GraphqlUpdatedNotification', 'reopened');
    expect(mocks.refetch).toHaveBeenCalledOnce();

    mocks.cacheHost.mockReturnValue(false);
    await Promise.resolve();
    await Promise.resolve();
    f.notification('GraphqlUpdatedNotification', 'shown');
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });
});

describe('shared open document notifications', () => {
  const holders: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const release of holders.splice(0)) release();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function hold(documentId = 'doc', enabled: Accessor<boolean> = () => true) {
    return createRoot((release) => {
      holders.push(release);
      return {
        query: useDocumentNotificationsQuery(documentId, enabled),
        release,
      };
    });
  }

  function mockQuery() {
    const destroyed = vi.fn();
    mocks.refetch.mockResolvedValue(undefined);
    mocks.createQuery.mockImplementation(() => {
      onCleanup(destroyed);
      return { refetch: mocks.refetch, isEnabled: true, data: [] };
    });
    return destroyed;
  }

  it('gives every reader of a document one query and one listener, ended after the last', () => {
    const destroyed = mockQuery();
    const drawer = hold();
    const sidePanel = hold();
    expect(sidePanel.query).toBe(drawer.query);
    expect(mocks.createQuery).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(1);

    for (const listener of mocks.listeners)
      listener({
        __typename: 'GraphqlNewNotification',
        notification: { id: 'n', entityId: 'doc' },
      });
    expect(mocks.refetch).toHaveBeenCalledOnce();

    drawer.release();
    expect(destroyed).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(1);
    sidePanel.release();
    vi.runOnlyPendingTimers();
    expect(destroyed).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);

    hold();
    expect(mocks.createQuery).toHaveBeenCalledTimes(2);
  });
});
