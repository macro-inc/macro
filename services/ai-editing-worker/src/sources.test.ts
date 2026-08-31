import type {
  FromRemote,
  IFromPeer,
} from '@macro-inc/collaboration/sync-service/generated/schema';
import type { SyncWebsocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  WebsocketConnectionState,
  WebsocketEvent,
  type WebsocketEventListener,
} from '@macro-inc/collaboration/websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerSyncSource } from './sources';

type AnyListener = WebsocketEventListener<
  WebsocketEvent,
  IFromPeer,
  FromRemote
>;

/** Minimal in-memory SyncSocket, mirroring the collaboration source tests. */
class FakeSocket {
  connectionState = WebsocketConnectionState.Connecting;
  sent: IFromPeer[] = [];
  heartbeats = 0;
  closed = false;
  private msg = new Set<AnyListener>();

  send(message: IFromPeer) {
    this.sent.push(message);
    return true;
  }
  startHeartbeat() {
    this.heartbeats++;
  }
  reconnectIfDisconnected() {}
  close() {
    this.closed = true;
  }
  addEventListener<K extends WebsocketEvent>(type: K, listener: AnyListener) {
    if (type === WebsocketEvent.Message) this.msg.add(listener);
  }
  removeEventListener<K extends WebsocketEvent>(
    _type: K,
    listener: AnyListener
  ) {
    this.msg.delete(listener);
  }

  deliver(data: FromRemote) {
    const event = { data } as Parameters<AnyListener>[1];
    for (const listener of [...this.msg]) listener(this as never, event);
  }

  asSyncWebsocket(): SyncWebsocket {
    return this as unknown as SyncWebsocket;
  }
}

const GUARDS = {
  isRemoteInitialSync: () => false,
  isRemoteUpdate: () => false,
  isRemoteAwareness: () => false,
  isRemoteSnapshot: () => false,
  isRemoteUpdateAck: () => false,
  isRemoteUpdateSince: () => false,
};

const remote = {
  initialSync: (snapshot: Uint8Array, awareness: Uint8Array) =>
    ({
      ...GUARDS,
      isRemoteInitialSync: () => true,
      value: { snapshot, awareness },
    }) as unknown as FromRemote,
  snapshot: (snapshot: Uint8Array) =>
    ({
      ...GUARDS,
      isRemoteSnapshot: () => true,
      value: { snapshot },
    }) as unknown as FromRemote,
  ack: (id: string) =>
    ({
      ...GUARDS,
      isRemoteUpdateAck: () => true,
      value: { id },
    }) as unknown as FromRemote,
};

const snap = new Uint8Array([1, 2, 3]);
const aw = new Uint8Array([4, 5]);

// From packages/collaboration/src/sync-service/source.ts.
const INITIAL_SYNC_TIMEOUT_MS = 10_000;
const FALLBACK_MS = 2_000;

describe('WorkerSyncSource snapshot fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves from RemoteInitialSync without ever requesting a snapshot', async () => {
    const ws = new FakeSocket();
    const src = new WorkerSyncSource(ws.asSyncWebsocket(), 'doc1');
    const pending = src.doInitialSync();
    ws.deliver(remote.initialSync(snap, aw));

    expect((await pending)._unsafeUnwrap()).toEqual({
      snapshot: snap,
      awareness: aw,
    });
    // The fallback timer is canceled; nothing is sent even after its delay.
    await vi.advanceTimersByTimeAsync(FALLBACK_MS + 1);
    expect(ws.sent).toHaveLength(0);
    expect(ws.heartbeats).toBe(1);
  });

  it('bootstraps from a requested snapshot when the push never arrives', async () => {
    const ws = new FakeSocket();
    const src = new WorkerSyncSource(ws.asSyncWebsocket(), 'doc1');
    const pending = src.doInitialSync();

    expect(ws.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FALLBACK_MS + 1);
    expect(ws.sent).toHaveLength(1); // PeerRequestSnapshot went out

    ws.deliver(remote.snapshot(snap));
    expect((await pending)._unsafeUnwrap()).toEqual({
      snapshot: snap,
      awareness: new Uint8Array(0),
    });
    expect(ws.heartbeats).toBe(1);
  });

  it('unlocks pushUpdate after a fallback bootstrap', async () => {
    const ws = new FakeSocket();
    const src = new WorkerSyncSource(ws.asSyncWebsocket(), 'doc1');
    const pending = src.doInitialSync();

    await vi.advanceTimersByTimeAsync(FALLBACK_MS + 1);
    ws.deliver(remote.snapshot(snap));
    await pending;

    const sentBefore = ws.sent.length;
    const acked = src.pushUpdate([new Uint8Array([9])]);
    expect(ws.sent.length).toBe(sentBefore + 1); // update went out
    const update = ws.sent[ws.sent.length - 1] as unknown as {
      value: { id: string };
    };
    ws.deliver(remote.ack(update.value.id));
    expect(await acked).toBe(true);
  });

  it('surfaces the initial-sync timeout when both paths stay silent', async () => {
    const ws = new FakeSocket();
    const src = new WorkerSyncSource(ws.asSyncWebsocket(), 'doc1');
    const pending = src.doInitialSync();

    // Push times out at 10s; the 2s-delayed snapshot request at 12s.
    await vi.advanceTimersByTimeAsync(
      FALLBACK_MS + INITIAL_SYNC_TIMEOUT_MS + 1
    );

    expect((await pending)._unsafeUnwrapErr()).toEqual({
      type: 'timeout',
      duration: INITIAL_SYNC_TIMEOUT_MS,
    });
  });

  it('does not request a snapshot after cleanup', async () => {
    const ws = new FakeSocket();
    const src = new WorkerSyncSource(ws.asSyncWebsocket(), 'doc1');
    void src.doInitialSync();

    src.cleanup();
    await vi.advanceTimersByTimeAsync(FALLBACK_MS + 1);

    expect(ws.sent).toHaveLength(0);
    expect(ws.closed).toBe(true);
  });
});
