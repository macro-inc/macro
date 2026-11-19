import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { type Client, CombinedError, gql } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelNotificationReader,
  channelNotificationRefresh,
  delegateChannelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from './notification-refresh';

const document = gql`query Notifications($id: String!) { channel(id: $id) { id } }`;
const descriptor = (id = 'a'): QueryRevalidation => ({
  document,
  variables: { id },
});
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup() {
  const request = vi
    .fn<() => Promise<{ data?: unknown; error?: CombinedError }>>()
    .mockResolvedValue({});
  const query = vi.fn((..._args: Parameters<Client['query']>) => ({
    toPromise: request,
  }));
  const client = { query } as unknown as Client;
  const queue = channelNotificationRefresh(client);
  cleanups.push(() => disposeChannelNotificationRefresh(client));
  const register = (
    id = 'a',
    overrides: Partial<ChannelNotificationReader> = {}
  ) => {
    const reader: ChannelNotificationReader = {
      enabled: true,
      fetching: false,
      filtered: false,
      channelId: id,
      notificationIds: [],
      ...overrides,
    };
    const dispose = queue.register(descriptor(id), reader);
    cleanups.push(dispose);
    return { reader, dispose };
  };
  return { queue, client, query, request, register };
}
function patch(id = 'a', updated = false): GraphqlNotificationPatch {
  return {
    __typename: updated
      ? 'GraphqlUpdatedNotification'
      : 'GraphqlNewNotification',
    notification: { id: 'notification', entityType: 'CHANNEL', entityId: id },
  } as GraphqlNotificationPatch;
}
const deletion = (
  entityId: string,
  graphqlTypeName = 'GraphqlNotification'
): GraphqlNotificationPatch => ({
  __typename: 'GraphqlCacheDeletion',
  entityId,
  graphqlTypeName,
});
const tick = () => vi.advanceTimersByTimeAsync(100);
function deferred() {
  let resolve!: (result: {}) => void;
  const promise = new Promise<{}>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('shared channel notification refresh', () => {
  it('shares one operation across readers and batches websocket + committed mutations', async () => {
    const f = setup();
    f.register();
    f.register();
    f.queue.onPatch(patch(), false);
    expect(delegateChannelNotificationRefresh(f.client, descriptor())).toBe(
      true
    );
    f.queue.onPatch(patch(), false);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith(
      document,
      { id: 'a' },
      { requestPolicy: 'network-only' }
    );
    expect(
      delegateChannelNotificationRefresh(f.client, descriptor('unmounted'))
    ).toBe(false);
  });

  it('does not interrupt initial or independent in-flight query loads', async () => {
    const f = setup();
    const { reader } = f.register('a', { fetching: true });
    f.queue.onPatch(patch(), false);
    await tick();
    expect(f.query).not.toHaveBeenCalled();
    reader.fetching = false;
    f.queue.changed();
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it('retains exactly one follow-up for events during a request', async () => {
    const f = setup();
    f.register();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    f.queue.onPatch(patch(), false);
    await tick();
    for (let i = 0; i < 20; i++) f.queue.onPatch(patch(), false);
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
    pending.resolve({});
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('caps concurrency across distinct projections at four', async () => {
    const f = setup();
    const pending = deferred();
    f.request.mockReturnValue(pending.promise);
    for (let i = 0; i < 9; i++) f.register(String(i));
    f.queue.reconnect();
    await tick();
    expect(f.query).toHaveBeenCalledTimes(4);
    pending.resolve({});
    await tick();
    expect(f.query).toHaveBeenCalledTimes(8);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(9);
  });

  it('lets normalized state changes update full edges but refreshes filtered badges', async () => {
    const f = setup();
    f.register('a', { notificationIds: ['notification'] });
    f.register('badge', { channelId: undefined, filtered: true });
    f.queue.onPatch(patch('a', true), true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0]).toEqual([
      document,
      { id: 'badge' },
      { requestPolicy: 'network-only' },
    ]);
    f.queue.onPatch(patch('a', true), false);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(3);
  });

  it('refreshes heterogeneous witnesses for non-channel changes without waking channel readers', async () => {
    const f = setup();
    f.register('channel');
    const home = f.register('home', {
      channelId: undefined,
      scope: 'all-entities',
      filtered: true,
      notificationIds: ['notification'],
    });
    const notification: GraphqlNotificationPatch = {
      ...patch('document', true),
      notification: {
        id: 'notification',
        entityType: 'DOCUMENT',
        entityId: 'document',
      },
    } as GraphqlNotificationPatch;
    f.queue.onPatch(notification, true);
    await tick();
    expect(f.query).toHaveBeenCalledExactlyOnceWith(
      document,
      { id: 'home' },
      { requestPolicy: 'network-only' }
    );
    // Replacing the single witness may reveal an older unread notification.
    home.reader.notificationIds = [];
    f.queue.onPatch(notification, true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
    home.reader.enabled = false;
    f.queue.onPatch(notification, true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('refreshes a full edge when an updated notification is not in its membership', async () => {
    const f = setup();
    f.register();
    f.queue.onPatch(patch('a', true), true);
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it('scopes known deletions, ignores unrelated types, and recovers unknown deletions', async () => {
    const f = setup();
    f.register('a', { notificationIds: ['known'] });
    f.register('b');
    f.queue.onPatch(deletion('unknown', 'GraphqlDocument'), true);
    await tick();
    expect(f.query).not.toHaveBeenCalled();
    f.queue.onPatch(deletion('known'), true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    f.queue.onPatch(deletion('unknown'), true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(3);
    f.queue.onPatch(deletion('b', 'GraphqlSoupChannel'), true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(4);
  });

  it('refreshes Home when another reader owns deleted thread-scoping evidence', async () => {
    const f = setup();
    f.register('thread', { notificationIds: ['seen-reply'] });
    f.register('other-channel');
    f.register('home', {
      scope: 'all-entities',
      channelId: undefined,
      filtered: true,
    });
    f.queue.onPatch(deletion('seen-reply'), true);
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.query.mock.calls.map((call) => call[1])).toEqual([
      { id: 'thread' },
      { id: 'home' },
    ]);
  });

  it('reconnects enabled readers without starting disabled or global feeds', async () => {
    const f = setup();
    f.register();
    f.register('b', { enabled: false });
    f.queue.reconnect();
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[0]).toEqual([
      document,
      { id: 'a' },
      { requestPolicy: 'network-only' },
    ]);
  });

  it('holds dirty work while hidden/offline, then resumes without another notification', async () => {
    const f = setup();
    f.register();
    vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(true);
    f.queue.onPatch(patch(), false);
    await tick();
    expect(f.query).not.toHaveBeenCalled();
    vi.spyOn(globalThis.document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(f.query).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it.each([
    new CombinedError({ networkError: new Error('offline') }),
    new CombinedError({
      graphQLErrors: [{ message: 'A comms error has occured' }],
    }),
    new CombinedError({
      graphQLErrors: [
        { message: 'Internal', extensions: { code: 'INTERNAL' } },
      ],
    }),
  ])(
    'recovers transient failures and server faults with exponential backoff capped at 30 seconds: %s',
    async (error) => {
      const f = setup();
      f.register();
      f.request.mockResolvedValue({ error });
      f.queue.onPatch(patch(), false);
      await tick();
      for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const before = f.query.mock.calls.length;
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(f.query).toHaveBeenCalledTimes(before);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.query).toHaveBeenCalledTimes(before + 1);
      }
      f.request.mockResolvedValue({});
      await vi.advanceTimersByTimeAsync(30000);
      const calls = f.query.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.query).toHaveBeenCalledTimes(calls);
    }
  );

  it.each([
    new CombinedError({
      graphQLErrors: [
        { message: 'forbidden', extensions: { code: 'FORBIDDEN' } },
      ],
    }),
    new CombinedError({
      networkError: new Error('unauthorized'),
      response: { status: 401 },
    }),
  ])(
    'does not automatically retry authorization/application errors',
    async (error) => {
      const f = setup();
      f.register();
      f.request.mockResolvedValue({ error });
      f.queue.onPatch(patch(), false);
      await tick();
      // Blocked jobs must leave committed revalidations to the caller's fallback.
      expect(delegateChannelNotificationRefresh(f.client, descriptor())).toBe(
        false
      );
      f.queue.reconnect();
      f.queue.onPatch(patch(), false);
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.query).toHaveBeenCalledOnce();
      const refresh = f.queue.refresh([descriptor()]);
      const failure = expect(refresh).rejects.toBe(error);
      await tick();
      await failure;
      expect(f.query).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    new CombinedError({
      graphQLErrors: [
        { message: 'forbidden', extensions: { code: 'FORBIDDEN' } },
      ],
    }),
    new CombinedError({
      networkError: new Error('unauthorized'),
      response: { status: 401 },
    }),
  ])(
    'settles overlapping refresh callers when a permanent failure blocks the job',
    async (error) => {
      const f = setup();
      f.register();
      const pending = deferred();
      f.request.mockReturnValueOnce(pending.promise);
      const errors: unknown[] = [];
      const refresh = async () => {
        try {
          await f.queue.refresh([descriptor()]);
        } catch (error) {
          errors.push(error);
        }
      };
      const first = refresh();
      await tick();
      const second = refresh();
      pending.resolve({ error });
      await tick();
      expect(errors).toEqual([error, error]);
      await Promise.all([first, second]);
      await vi.advanceTimersByTimeAsync(30000);
      expect(f.query).toHaveBeenCalledOnce();
      const retry = f.queue.refresh([descriptor()]);
      await tick();
      await retry;
      expect(f.query).toHaveBeenCalledTimes(2);
    }
  );

  it('waits for the generation requested by an explicit refresh', async () => {
    const f = setup();
    f.register();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    f.queue.onPatch(patch(), false);
    await tick();
    const done = vi.fn();
    const refresh = f.queue.refresh([descriptor()]).then(done);
    pending.resolve({});
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    await tick();
    await refresh;
    expect(done).toHaveBeenCalledOnce();
  });

  it('rejects an explicit refresh when its reader becomes disabled', async () => {
    const f = setup();
    const { reader } = f.register('a', { fetching: true });
    const refresh = f.queue.refresh([descriptor()]);
    const failure = expect(refresh).rejects.toThrow('disabled');
    reader.enabled = false;
    f.queue.changed();
    await failure;
    await tick();
    expect(f.query).not.toHaveBeenCalled();
  });

  it('lets explicit retries bypass an existing background retry delay', async () => {
    const f = setup();
    f.register();
    f.request.mockResolvedValueOnce({
      error: new CombinedError({ networkError: new Error('offline') }),
    });
    f.queue.onPatch(patch(), false);
    await tick();
    const refresh = f.queue.refresh([descriptor()]);
    await tick();
    await refresh;
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('unregisters duplicate views independently and cancels the last pending job', async () => {
    const f = setup();
    const a = f.register();
    const b = f.register();
    f.queue.onPatch(patch(), false);
    a.dispose();
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
    f.queue.onPatch(patch(), false);
    b.dispose();
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
  });

  it('fences late completions and retries after client replacement', async () => {
    const f = setup();
    f.register();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    f.queue.onPatch(patch(), false);
    await tick();
    f.queue.onPatch(patch(), false);
    disposeChannelNotificationRefresh(f.client);
    pending.resolve({});
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
    expect(delegateChannelNotificationRefresh(f.client, descriptor())).toBe(
      false
    );
    const next = setup();
    next.register();
    next.queue.reconnect();
    await tick();
    expect(next.query).toHaveBeenCalledOnce();
  });

  it('fences a cache reset and refreshes the replacement session', async () => {
    const f = setup();
    f.register();
    const pending = deferred();
    f.request.mockReturnValueOnce(pending.promise);
    f.queue.onPatch(patch(), false);
    await tick();
    f.queue.reset();
    pending.resolve({});
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('suspends pagehide work and reconciles on restoration', async () => {
    const f = setup();
    f.register();
    f.queue.suspend(true);
    f.queue.onPatch(patch(), false);
    await tick();
    expect(f.query).not.toHaveBeenCalled();
    f.queue.suspend(false);
    await tick();
    expect(f.query).toHaveBeenCalledOnce();
  });
});

describe('new channels reaching channel lists', () => {
  const firstPage = (scope: string): QueryRevalidation => ({
    document,
    variables: { input: { initial: { scope } } },
  });
  const nextPage = (scope: string): QueryRevalidation => ({
    document,
    variables: { input: { continuation: { cursor: scope } } },
  });
  const page = (...ids: string[]) => ({
    data: { user: { soup: { items: ids.map((id) => ({ id })) } } },
  });
  function list(
    f: ReturnType<typeof setup>,
    query: QueryRevalidation,
    channelTypes: readonly string[]
  ) {
    cleanups.push(
      f.queue.register(query, {
        enabled: true,
        fetching: false,
        filtered: true,
        notificationIds: [],
        channelTypes,
      })
    );
  }

  it('reads a list showing the channel type again until the new channel is on its first page', async () => {
    const f = setup();
    list(f, firstPage('dms'), ['direct_message']);
    f.request
      .mockResolvedValueOnce(page('older'))
      .mockResolvedValueOnce(page('older'))
      .mockResolvedValueOnce(page('new', 'older'));

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.query).toHaveBeenCalledTimes(3);
  });

  it('runs an explicit refresh made during a read without waiting for the backoff', async () => {
    const f = setup();
    list(f, firstPage('dms'), ['direct_message']);
    const inFlight = deferred();
    f.request
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValue(page('older'));

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    const refreshed = f.queue.refresh([firstPage('dms')]);
    inFlight.resolve(page('older'));
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
    await refreshed;
  });

  it('stops waiting for a channel when the cache or session is replaced', async () => {
    const f = setup();
    list(f, firstPage('dms'), ['direct_message']);
    f.request.mockResolvedValue(page('older'));

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await tick();
    expect(f.query).toHaveBeenCalledTimes(1);
    f.queue.reset();
    await tick();
    expect(f.query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('leaves lists of other channel types and continuation pages alone', async () => {
    const f = setup();
    list(f, firstPage('team'), ['team']);
    list(f, nextPage('dms'), ['direct_message']);

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.query).not.toHaveBeenCalled();
  });

  it('keeps the first wait when later messages push the same channel again', async () => {
    const f = setup();
    list(f, firstPage('dms'), ['direct_message']);
    f.request.mockResolvedValue(page('older'));

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await vi.advanceTimersByTimeAsync(50_000);
    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await vi.advanceTimersByTimeAsync(30_000);
    const reads = f.query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.query).toHaveBeenCalledTimes(reads);
  });

  it('stops reading a minute after the push when the channel never appears', async () => {
    const f = setup();
    list(f, firstPage('dms'), ['direct_message']);
    f.request.mockResolvedValue(page('older'));

    f.queue.expectChannel({ id: 'new', channelType: 'direct_message' });
    await vi.advanceTimersByTimeAsync(120_000);
    const reads = f.query.mock.calls.length;
    expect(reads).toBeGreaterThan(3);
    expect(reads).toBeLessThan(10);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.query).toHaveBeenCalledTimes(reads);
  });
});
