import type { Client } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerActivityRevalidator } from '../../queries/activity/push-registry';
import { createActivityUpdatesHandler } from './graphql-activity-updates';

const cleanups: Array<() => void> = [];
function setup() {
  const client = { query: vi.fn(), subscription: vi.fn() } as unknown as Client;
  const handler = createActivityUpdatesHandler(client);
  cleanups.push(handler.dispose);
  const refresh = vi.fn();
  cleanups.push(registerActivityRevalidator({ client: () => client, refresh }));
  return { client, handler, refresh };
}
const push = (id: string) =>
  ({
    data: {
      activityUpdates: { __typename: 'GraphqlActivityEvent', entityId: id },
    },
  }) as never;
const flush = () => vi.advanceTimersByTimeAsync(1001);
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('activity connection revalidation', () => {
  it('coalesces events and keeps clients isolated', async () => {
    const one = setup(),
      two = setup();
    one.handler.onResult(push('one'));
    one.handler.onResult(push('two'));
    one.handler.onResult(push('one'));
    await flush();
    expect(one.refresh).toHaveBeenCalledExactlyOnceWith(
      new Set(['one', 'two'])
    );
    expect(two.refresh).not.toHaveBeenCalled();
  });
  it('recovers all queries on reconnect without requiring a later push', async () => {
    const { handler, refresh } = setup();
    handler.reconnect();
    await flush();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('recovers purge invalidations through fresh authorized reads', async () => {
    const { handler, refresh } = setup();
    handler.onResult({
      data: {
        activityUpdates: {
          __typename: 'GraphqlActivityInvalidation',
          refresh: true,
        },
      },
    } as never);
    await flush();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('holds hidden-tab updates until visible', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { handler, refresh } = setup();
    handler.onResult(push('one'));
    await flush();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(new Set(['one']));
  });
  it('cleans up timers, hidden-tab listeners, and late callbacks', async () => {
    const { handler, refresh } = setup();
    handler.onResult(push('one'));
    handler.dispose();
    handler.onResult(push('two'));
    handler.reconnect();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('runs a trailing refresh for pushes received during an ongoing refresh', async () => {
    const { handler, refresh } = setup();
    let finish!: () => void;
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        })
    );
    handler.onResult(push('one'));
    await flush();
    handler.onResult(push('two'));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    expect(refresh).toHaveBeenNthCalledWith(2, new Set(['two']));
  });
  it('does not schedule a trailing refresh after disposal', async () => {
    const { handler, refresh } = setup();
    let finish!: () => void;
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        })
    );
    handler.onResult(push('one'));
    await flush();
    handler.onResult(push('two'));
    handler.dispose();
    finish();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('ignores unmounted queries and still refreshes siblings after errors', async () => {
    const { handler, client, refresh } = setup();
    const stale = vi.fn();
    const unregister = registerActivityRevalidator({
      client: () => client,
      refresh: stale,
    });
    unregister();
    cleanups.push(
      registerActivityRevalidator({
        client: () => client,
        refresh: () => {
          throw Error('unavailable');
        },
      })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    handler.onResult(push('one'));
    await flush();
    expect(stale).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
