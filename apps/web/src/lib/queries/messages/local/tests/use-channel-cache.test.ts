import type { CacheGenerationChange } from '@graphql-cache/host/types';
import type { CacheHost } from '@graphql-cache/index';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelCache } from '../use-channel-cache';

const mocks = vi.hoisted(() => ({
  flag: vi.fn(() => ({ enabled: true, loading: false, payload: undefined })),
  channelCacheHost: vi.fn((): unknown => undefined),
  rawHost: vi.fn((): unknown => undefined),
  rereadChannelsAfterStorageReset: vi.fn(),
  resetChannelSync: vi.fn(),
  storeUnstoredPushes: vi.fn(async () => {}),
  holdUnheldReads: vi.fn(async () => {}),
  resetPendingChannelPages: vi.fn(),
  holdUnqueuedSendsPage: vi.fn(),
  resendUnqueuedSends: vi.fn(async (..._args: unknown[]) => 0),
  sendChannelMessage: vi.fn(async () => ({})),
  sendLeftBehindOverRest: vi.fn(async () => {}),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableChannelLocalSync: { key: 'enable-channel-local-sync' },
}));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => false,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: mocks.rawHost,
  subscribeGraphqlSoupReconnected: () => () => {},
}));
vi.mock('../flag', () => ({ channelCacheHost: mocks.channelCacheHost }));
vi.mock('../catch-up', () => ({
  rereadChannelsAfterStorageReset: mocks.rereadChannelsAfterStorageReset,
  resetChannelSync: mocks.resetChannelSync,
  storeUnstoredPushes: mocks.storeUnstoredPushes,
}));
vi.mock('../source', () => ({ holdUnheldReads: mocks.holdUnheldReads }));
vi.mock('../pages', () => ({
  resetPendingChannelPages: mocks.resetPendingChannelPages,
}));
vi.mock('../prewarm', () => ({
  evictIdleChannels: vi.fn(),
  runChannelPrewarmPass: vi.fn(),
}));
vi.mock('../prewarm-list', () => ({ loadPrewarmChannelIds: vi.fn() }));
vi.mock('../unqueued-sends', () => ({
  holdUnqueuedSendsPage: mocks.holdUnqueuedSendsPage,
  resendUnqueuedSends: mocks.resendUnqueuedSends,
}));
vi.mock('../writes', () => ({ sendChannelMessage: mocks.sendChannelMessage }));
vi.mock('../left-behind-sends', () => ({
  queueIfAnswering: (host: unknown) => ({ answering: host }),
  sendLeftBehindOverRest: mocks.sendLeftBehindOverRest,
}));

const send = {
  channelId: 'channel-1',
  id: 'message-1',
  senderId: 'sender-1',
  message: { content: 'left behind' },
};

function hostWithGenerations() {
  const listeners: ((change: CacheGenerationChange) => void)[] = [];
  const host = {
    onCacheGenerationChanged: vi.fn(
      (listener: (change: CacheGenerationChange) => void) => {
        listeners.push(listener);
        return () => {};
      }
    ),
  } as unknown as CacheHost;
  return {
    host,
    emit: (change: CacheGenerationChange) => {
      for (const listener of listeners) listener(change);
    },
  };
}

let dispose = () => {};
function mount() {
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    useChannelCache(() => 'sender-1');
  });
}

afterEach(() => {
  dispose();
  vi.clearAllMocks();
});

describe('useChannelCache', () => {
  it('with the flag on, resends through the queue and rereads after a storage reset', async () => {
    const { host, emit } = hostWithGenerations();
    mocks.flag.mockReturnValue({
      enabled: true,
      loading: false,
      payload: undefined,
    });
    mocks.channelCacheHost.mockReturnValue(host);

    mount();
    await Promise.resolve();

    expect(mocks.holdUnqueuedSendsPage).toHaveBeenCalled();
    expect(mocks.storeUnstoredPushes).toHaveBeenCalledWith(host);
    expect(mocks.holdUnheldReads).toHaveBeenCalledWith(host);
    const [resendHost, sender, resend] = mocks.resendUnqueuedSends.mock
      .calls[0] as [unknown, string, (send: unknown, at: string) => void];
    expect([resendHost, sender]).toEqual([host, 'sender-1']);
    resend(send, '2026-01-01T00:00:00.000Z');
    expect(mocks.sendChannelMessage).toHaveBeenCalledWith(
      host,
      send,
      expect.anything()
    );
    expect(mocks.sendLeftBehindOverRest).not.toHaveBeenCalled();

    emit({ storage: 'preserved' });
    expect(mocks.rereadChannelsAfterStorageReset).not.toHaveBeenCalled();
    emit({ storage: 'reset' });
    expect(mocks.rereadChannelsAfterStorageReset).toHaveBeenCalledOnce();
  });

  it('with the flag off, runs nothing but the REST delivery of noted sends', async () => {
    const { host } = hostWithGenerations();
    mocks.flag.mockReturnValue({
      enabled: false,
      loading: false,
      payload: undefined,
    });
    // The cache itself still runs; only channels are off it.
    mocks.rawHost.mockReturnValue(host);
    mocks.channelCacheHost.mockReturnValue(undefined);

    mount();
    await Promise.resolve();

    expect(host.onCacheGenerationChanged).not.toHaveBeenCalled();
    // Held so another tab starting now does not post the same sends.
    expect(mocks.holdUnqueuedSendsPage).toHaveBeenCalled();
    expect(mocks.storeUnstoredPushes).not.toHaveBeenCalled();
    expect(mocks.holdUnheldReads).not.toHaveBeenCalled();
    expect(mocks.resendUnqueuedSends).toHaveBeenCalledOnce();
    const [resendHost, sender, resend] = mocks.resendUnqueuedSends.mock
      .calls[0] as [unknown, string, (send: unknown, at: string) => void];
    // The queue is still asked what it holds, without waiting on it.
    expect([resendHost, sender]).toEqual([{ answering: host }, 'sender-1']);
    resend(send, '2026-01-01T00:00:00.000Z');
    expect(mocks.sendLeftBehindOverRest).toHaveBeenCalledExactlyOnceWith(send);
    expect(mocks.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('does nothing while the flag has not been answered', async () => {
    mocks.flag.mockReturnValue({
      enabled: false,
      loading: true,
      payload: undefined,
    });
    mocks.channelCacheHost.mockReturnValue(undefined);

    mount();
    await Promise.resolve();

    expect(mocks.resendUnqueuedSends).not.toHaveBeenCalled();
    expect(mocks.holdUnqueuedSendsPage).not.toHaveBeenCalled();
  });
});
