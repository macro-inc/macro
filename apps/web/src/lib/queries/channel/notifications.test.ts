import { SoupNotificationsDocument } from '@service-storage/graphql/generated/graphql';
import type { GraphqlNotificationPatch } from '@service-storage/graphql-soup-websocket';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import { createChannelNotificationsQuery } from './notifications';

const mocks = vi.hoisted(() => ({
  createQuery: vi.fn(),
  refetch: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  client: {},
}));
vi.mock('@app/lib/urql-solid', () => ({ createUrqlQuery: mocks.createQuery }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => mocks.client,
  mapGraphqlNotification: (n: unknown) => n,
}));
vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: mocks.subscribe,
}));
let dispose: () => void;
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function setup() {
  vi.useFakeTimers();
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
  mocks.createQuery.mockReturnValue({ refetch: mocks.refetch });
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [enabled, setEnabled] = createSignal(true);
    createChannelNotificationsQuery('channel', enabled);
    const patch = (entityId = 'channel', kind = 'GraphqlNewNotification') => {
      mocks.subscribe.mock.calls[0][0]({
        __typename: kind,
        notification: { entityType: 'CHANNEL', entityId },
      } as GraphqlNotificationPatch);
    };
    return { setEnabled, patch };
  });
}

describe('complete channel notification edge', () => {
  it('registers only this channel for read-state reconciliation while enabled', () => {
    const f = setup();
    const options = mocks.createQuery.mock.calls[0][0]();
    expect(options.query).toBe(SoupNotificationsDocument);
    expect(options.variables.input.initial.filters.channelFilter).toEqual({
      literal: { channelId: 'channel' },
    });
    expect(options.variables.input.initial.limit).toBe(1);
    expect(getActiveGraphqlSoupRevalidations()).toHaveLength(1);
    f.setEnabled(false);
    expect(mocks.createQuery.mock.calls[0][0]().enabled).toBe(false);
    expect(getActiveGraphqlSoupRevalidations()).toHaveLength(0);
  });

  it('coalesces live deliveries and remote state changes, without fetching other channels', async () => {
    const f = setup();
    f.patch('another-channel');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).not.toHaveBeenCalled();
    f.patch();
    f.patch('channel', 'GraphqlUpdatedNotification');
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.refetch).toHaveBeenCalledWith({
      requestPolicy: 'network-only',
      throwOnError: true,
    });
    f.setEnabled(false);
    f.patch();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('refreshes again when a delivery arrives during an in-flight snapshot', async () => {
    const f = setup();
    let finish = () => {};
    mocks.refetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    f.patch();
    await vi.advanceTimersByTimeAsync(100);
    f.patch();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });

  it('cancels pending refreshes and subscriptions on channel close', async () => {
    const f = setup();
    f.patch();
    dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(getActiveGraphqlSoupRevalidations()).toHaveLength(0);
  });
});
