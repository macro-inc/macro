import {
  type UrlResolver,
  WebsocketBuilder,
  WebsocketConnectionState,
} from '@macro-inc/collaboration/websocket';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  socket: vi.fn<(resolver: UrlResolver) => object>(() => ({})),
}));
vi.mock('@macro-inc/collaboration/sync-service/socket', () => ({
  createSyncSocket: mocks.socket,
}));
vi.mock('@block-md/observability', () => ({
  resumeDocumentSpan: () => undefined,
}));
vi.mock('@core/constant/servers', () => ({
  SYNC_SERVICE_HOSTS: { ws: 'wss://sync.test' },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

import {
  createSyncServiceSocket,
  createTokenRefreshingSocket,
} from './helpers';

function resolveUrl() {
  const resolver = mocks.socket.mock.calls.at(-1)![0];
  if (typeof resolver !== 'function')
    throw new Error('Expected lazy URL resolver');
  return resolver();
}

beforeEach(() => vi.clearAllMocks());

describe('deferred document authorization', () => {
  it('reports failed authorization as disconnected rather than waiting for a nonexistent close event', async () => {
    const { ws, state, dispose } = createRoot((dispose) => {
      const ws = new WebsocketBuilder(async () => {
        throw new Error('Offline');
      }).build();
      return { ws, state: createWebsocketStateSignal(ws), dispose };
    });
    try {
      await vi.waitFor(() =>
        expect(state()).toBe(WebsocketConnectionState.Closed)
      );
    } finally {
      ws.close();
      dispose();
    }
  });

  it('never connects without fresh authority or falls back to a previously fetched token', async () => {
    const getToken = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce('fresh-token')
      .mockResolvedValueOnce(undefined);
    createTokenRefreshingSocket('doc', undefined, getToken);
    await expect(resolveUrl()).rejects.toThrow('Offline');
    expect(new URL(await resolveUrl()).searchParams.get('token')).toBe(
      'fresh-token'
    );
    await expect(resolveUrl()).rejects.toThrow('Unable to authorize');
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('does not use a supplied initial token for a session-bound source', async () => {
    const getToken = vi.fn(async () => 'authorized-token');
    createSyncServiceSocket('doc', 'stale-token', {
      getToken,
      isCurrent: () => true,
      canWrite: () => true,
      onInvalidated: () => () => {},
    });
    expect(new URL(await resolveUrl()).searchParams.get('token')).toBe(
      'authorized-token'
    );
    expect(getToken).toHaveBeenCalledOnce();
  });

  it('preserves the existing initial-token path for other callers', async () => {
    const getToken = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValue(undefined);
    createTokenRefreshingSocket('doc', 'initial-token', getToken);
    expect(new URL(await resolveUrl()).searchParams.get('token')).toBe(
      'initial-token'
    );
    expect(getToken).not.toHaveBeenCalled();
    expect(new URL(await resolveUrl()).searchParams.get('token')).toBe(
      'initial-token'
    );
    expect(getToken).toHaveBeenCalledOnce();
  });
});
