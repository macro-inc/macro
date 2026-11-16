import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Accessor, createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentNotificationsQuery,
  useDocumentNotificationsQuery,
} from '../graphql/document-notifications';
import { revalidateNotificationReaders } from '../revalidation';

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
  work: [] as unknown[],
}));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: unknown) => {
    mocks.work.push(work);
    Promise.resolve(work).catch(() => {});
  },
}));
vi.mock('@app/lib/urql-solid', () => ({ createUrqlQuery: mocks.createQuery }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  hasGraphqlCacheHost: mocks.cacheHost,
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
  mocks.work = [];
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

  it('is kept current by cached notification writes, and read again without the cache', async () => {
    setup();
    await revalidateNotificationReaders(mocks.client as never, {
      unmaintainedOnly: true,
    });
    expect(mocks.refetch).not.toHaveBeenCalled();

    mocks.cacheHost.mockReturnValue(false);
    await revalidateNotificationReaders(mocks.client as never, {
      unmaintainedOnly: true,
    });
    expect(mocks.refetch).toHaveBeenCalledExactlyOnceWith({
      requestPolicy: 'network-only',
      throwOnError: true,
    });
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

  it('reads again when a shown notification is deleted', () => {
    const f = setup([{ id: 'shown' }]);
    const deletion = (graphqlTypeName: string, entityId: string) =>
      f.deliver({
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName,
        entityId,
      });
    deletion('GraphqlNotification', 'unknown');
    deletion('GraphqlSoupDocument', 'shown');
    expect(mocks.refetch).not.toHaveBeenCalled();
    deletion('GraphqlNotification', 'shown');
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reads once more after a delivery that lands during a read', async () => {
    const f = setup();
    const first = Promise.withResolvers<void>();
    mocks.refetch.mockReturnValueOnce(first.promise);
    f.notification('GraphqlNewNotification', 'a');
    f.notification('GraphqlNewNotification', 'b');
    f.notification('GraphqlNewNotification', 'c');
    expect(mocks.refetch).toHaveBeenCalledOnce();
    first.resolve();
    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
  });

  it('still reads a delivery queued behind a failed read, and succeeds with it', async () => {
    const f = setup();
    const first = Promise.withResolvers<void>();
    mocks.refetch.mockReturnValueOnce(first.promise);
    f.notification('GraphqlNewNotification', 'a');
    f.notification('GraphqlNewNotification', 'b');
    first.reject(new Error('offline'));

    await vi.waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(2));
    expect(mocks.work[1]).toBe(mocks.work[0]);
    await expect(mocks.work[0]).resolves.toBeUndefined();
    f.notification('GraphqlNewNotification', 'c');
    expect(mocks.refetch).toHaveBeenCalledTimes(3);
  });

  it('reports a failure of the last read', async () => {
    const f = setup();
    const first = Promise.withResolvers<void>();
    const error = new Error('still offline');
    mocks.refetch
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(error);
    f.notification('GraphqlNewNotification', 'a');
    f.notification('GraphqlNewNotification', 'b');
    first.resolve();

    await expect(mocks.work[0]).rejects.toBe(error);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it('reads, listens and registers nothing while the session cannot read notifications', async () => {
    const [enabled, setEnabled] = createSignal(false);
    const f = setup([], enabled);
    expect(f.options.enabled).toBe(false);
    expect(mocks.listeners.size).toBe(0);
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).not.toHaveBeenCalled();

    setEnabled(true);
    expect(mocks.createQuery.mock.calls[0][0]().enabled).toBe(true);
    expect(mocks.listeners.size).toBe(1);
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).toHaveBeenCalledOnce();

    setEnabled(false);
    expect(mocks.listeners.size).toBe(0);
  });

  it('stops listening and reading when the document closes', async () => {
    const f = setup();
    dispose();
    expect(mocks.listeners.size).toBe(0);
    f.notification('GraphqlNewNotification', 'n');
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).not.toHaveBeenCalled();
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

  it('gives every reader of a document one query and one listener, ended by the last', () => {
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

  it('lets a reader that remounts within the grace period reuse the query', () => {
    const destroyed = mockQuery();
    hold().release();
    vi.advanceTimersByTime(29_000);
    expect(destroyed).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(1);

    const remounted = hold();
    expect(mocks.createQuery).toHaveBeenCalledOnce();
    expect(mocks.createQuery.mock.calls[0][0]().enabled).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(destroyed).not.toHaveBeenCalled();

    remounted.release();
    vi.advanceTimersByTime(29_000);
    expect(destroyed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(mocks.listeners.size).toBe(0);
    hold();
    expect(mocks.createQuery).toHaveBeenCalledTimes(2);
  });

  it('keeps separate documents apart', () => {
    mockQuery();
    expect(hold('a').query).not.toBe(hold('b').query);
    expect(mocks.createQuery).toHaveBeenCalledTimes(2);
  });

  it('reads while any of its readers may', () => {
    mockQuery();
    const disabled = hold('doc', () => false);
    const options = mocks.createQuery.mock.calls[0][0];
    expect(options().enabled).toBe(false);
    const enabled = hold('doc', () => true);
    expect(options().enabled).toBe(true);
    enabled.release();
    expect(options().enabled).toBe(false);
    disabled.release();
  });
});
