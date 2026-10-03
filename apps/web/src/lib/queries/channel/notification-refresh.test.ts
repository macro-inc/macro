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
    .fn<() => Promise<{ error?: CombinedError }>>()
    .mockResolvedValue({});
  const query = vi.fn(() => ({ toPromise: request }));
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

  it('recovers transient failures with exponential backoff capped at 30 seconds', async () => {
    const f = setup();
    f.register();
    f.request.mockResolvedValue({
      error: new CombinedError({ networkError: new Error('offline') }),
    });
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
  });

  it.each([
    new CombinedError({ graphQLErrors: ['forbidden'] }),
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
    new CombinedError({ graphQLErrors: ['forbidden'] }),
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
