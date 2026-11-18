import { SoupUnseenNotificationsDocument } from '@service-storage/graphql/generated/graphql';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Accessor, createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGraphqlEntitySoupInput } from '../../soup/graphql/entity-input';
import {
  createLiveNotificationQuery,
  createSharedNotificationReads,
  type NotificationUpdate,
} from '../graphql/shared-notification-query';
import { revalidateNotificationReaders } from '../revalidation';

const mocks = vi.hoisted(() => ({
  createQuery: vi.fn(),
  refetch: vi.fn(),
  listeners: new Set<(patch: unknown) => void>(),
  reconnectListeners: new Set<() => void>(),
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
  subscribeGraphqlSoupReconnected: (listener: () => void) => {
    mocks.reconnectListeners.add(listener);
    return () => mocks.reconnectListeners.delete(listener);
  },
}));
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
  vi.restoreAllMocks();
  mocks.cacheHost.mockReturnValue(true);
  mocks.work = [];
});

const select = vi.fn();

function setup(
  options: {
    held?: { id: string }[];
    enabled?: Accessor<boolean>;
    updateChangesEdge?: (
      update: NotificationUpdate,
      held: boolean,
      cacheMaintained: boolean
    ) => boolean;
  } = {}
) {
  mocks.refetch.mockResolvedValue(undefined);
  mocks.createQuery.mockReturnValue({
    refetch: mocks.refetch,
    isEnabled: true,
    data: options.held ?? [],
  });
  createRoot((cleanup) => {
    dispose = cleanup;
    createLiveNotificationQuery({
      entityId: 'entity',
      query: SoupUnseenNotificationsDocument,
      variables: { input: buildGraphqlEntitySoupInput('DOCUMENT', 'entity')! },
      select,
      enabled: options.enabled ?? (() => true),
      updateChangesEdge: options.updateChangesEdge ?? (() => false),
      surface: 'test',
    });
  });
  const queryOptions = mocks.createQuery.mock.calls[0][0]();
  const deliver = (patch: object) => {
    for (const listener of mocks.listeners)
      listener(patch as GraphqlNotificationPatch);
  };
  const notification = (
    kind: 'GraphqlNewNotification' | 'GraphqlUpdatedNotification',
    id: string,
    entityId = 'entity'
  ) => deliver({ __typename: kind, notification: { id, entityId } });
  return { options: queryOptions, deliver, notification };
}

describe('live notification query', () => {
  it('reads the given edge as a live, user-visible request', () => {
    const { options } = setup();
    expect(options.query).toBe(SoupUnseenNotificationsDocument);
    expect(options.client).toBe(mocks.client);
    expect(options.variables.input.initial.filters.documentFilter).toEqual({
      literal: { id: 'entity' },
    });
    expect(options.select).toBe(select);
    expect(options.requestPolicy).toBe('cache-and-network');
    expect(options.context).toBeUndefined();
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

  it('reads again for its entity’s new notifications and its held rows’ deletions', () => {
    const f = setup({ held: [{ id: 'held' }] });
    const deletion = (graphqlTypeName: string, entityId: string) =>
      f.deliver({
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName,
        entityId,
      });
    f.notification('GraphqlNewNotification', 'n', 'another-entity');
    deletion('GraphqlNotification', 'not-held');
    deletion('GraphqlSoupDocument', 'held');
    expect(mocks.refetch).not.toHaveBeenCalled();
    deletion('GraphqlNotification', 'held');
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('asks the caller whether an update of its entity changes the edge', () => {
    const updateChangesEdge = vi.fn(
      (update: NotificationUpdate) => update.id === 'reread'
    );
    const f = setup({ held: [{ id: 'held' }], updateChangesEdge });
    f.notification('GraphqlUpdatedNotification', 'held', 'another-entity');
    expect(updateChangesEdge).not.toHaveBeenCalled();

    mocks.cacheHost.mockReturnValue(false);
    f.notification('GraphqlUpdatedNotification', 'held');
    expect(updateChangesEdge).toHaveBeenLastCalledWith(
      { id: 'held', entityId: 'entity' },
      true,
      false
    );
    expect(mocks.refetch).not.toHaveBeenCalled();
    f.notification('GraphqlUpdatedNotification', 'reread');
    expect(updateChangesEdge).toHaveBeenLastCalledWith(
      { id: 'reread', entityId: 'entity' },
      false,
      false
    );
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

  it('leaves deliveries to a hidden tab for one read when it is shown again', () => {
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    const f = setup();
    f.notification('GraphqlNewNotification', 'a');
    f.notification('GraphqlNewNotification', 'b');
    expect(mocks.refetch).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reads again when the websocket reconnects', () => {
    setup();
    for (const listener of mocks.reconnectListeners) listener();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reads, listens and registers nothing while the session cannot read notifications', async () => {
    const [enabled, setEnabled] = createSignal(false);
    const f = setup({ enabled });
    expect(f.options.enabled).toBe(false);
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.reconnectListeners.size).toBe(0);
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).not.toHaveBeenCalled();

    setEnabled(true);
    expect(mocks.createQuery.mock.calls[0][0]().enabled).toBe(true);
    expect(mocks.listeners.size).toBe(1);
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).toHaveBeenCalledOnce();

    setEnabled(false);
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.reconnectListeners.size).toBe(0);
  });

  it('stops listening and reading when its reader closes', async () => {
    const f = setup();
    dispose();
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.reconnectListeners.size).toBe(0);
    f.notification('GraphqlNewNotification', 'n');
    await revalidateNotificationReaders(mocks.client as never);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });
});

describe('shared notification reads', () => {
  const holders: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    for (const release of holders.splice(0)) release();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function registry() {
    const created = vi.fn();
    const destroyed = vi.fn();
    const shared = createSharedNotificationReads<{
      enabled: Accessor<boolean>;
    }>();
    const hold = (key = 'a', enabled: Accessor<boolean> = () => true) =>
      createRoot((release) => {
        holders.push(release);
        const value = shared(key, enabled, (anyEnabled) => {
          created(key);
          onCleanup(destroyed);
          return { enabled: anyEnabled };
        });
        return { value, release };
      });
    return { hold, created, destroyed };
  }

  it('gives every reader of a key one instance, ended a grace period after the last', () => {
    const { hold, created, destroyed } = registry();
    const drawer = hold();
    const sidePanel = hold();
    expect(sidePanel.value).toBe(drawer.value);
    expect(created).toHaveBeenCalledOnce();

    drawer.release();
    sidePanel.release();
    vi.advanceTimersByTime(29_999);
    expect(destroyed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(destroyed).toHaveBeenCalledOnce();

    hold();
    expect(created).toHaveBeenCalledTimes(2);
  });

  it('lets a reader that remounts within the grace period reuse the instance, still enabled', () => {
    const { hold, created, destroyed } = registry();
    const first = hold();
    first.release();
    expect(first.value.enabled()).toBe(true);
    vi.advanceTimersByTime(29_000);

    const remounted = hold();
    expect(remounted.value).toBe(first.value);
    expect(created).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(destroyed).not.toHaveBeenCalled();

    remounted.release();
    vi.advanceTimersByTime(30_000);
    expect(destroyed).toHaveBeenCalledOnce();
  });

  it('keeps separate keys apart', () => {
    const { hold, created } = registry();
    expect(hold('a').value).not.toBe(hold('b').value);
    expect(created).toHaveBeenCalledTimes(2);
  });

  it('is enabled while any of its readers may read', () => {
    const { hold } = registry();
    const disabled = hold('a', () => false);
    expect(disabled.value.enabled()).toBe(false);
    const enabled = hold('a', () => true);
    expect(disabled.value.enabled()).toBe(true);
    enabled.release();
    expect(disabled.value.enabled()).toBe(false);
  });
});
