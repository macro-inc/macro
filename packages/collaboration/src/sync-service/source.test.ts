import { describe, expect, it, vi } from 'vitest';
import type { SyncSourceEvent } from '../collab/source';
import {
  WebsocketConnectionState,
  WebsocketEvent,
  type WebsocketEventListener,
} from '../websocket';
import type { FromRemote, IFromPeer } from './generated/schema';
import type { SyncSocket } from './socket';
import { SyncServiceSource, TIMEOUTS } from './source';

type AnyListener = WebsocketEventListener<
  WebsocketEvent,
  IFromPeer,
  FromRemote
>;

// Minimal in-memory SyncSocket. Drives the class through deliver()/fireReconnect().
class FakeSocket implements SyncSocket {
  connectionState = WebsocketConnectionState.Connecting;
  sent: IFromPeer[] = [];
  heartbeats = 0;
  reconnects = 0;
  closed = false;
  private msg = new Set<AnyListener>();
  private recon = new Set<AnyListener>();

  send(message: IFromPeer) {
    this.sent.push(message);
    return true;
  }
  startHeartbeat() {
    this.heartbeats++;
  }
  reconnectIfDisconnected() {
    this.reconnects++;
  }
  close() {
    this.closed = true;
  }
  addEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ) {
    if (type === WebsocketEvent.Message) this.msg.add(listener as AnyListener);
    else if (type === WebsocketEvent.Reconnect)
      this.recon.add(listener as AnyListener);
  }
  removeEventListener<K extends WebsocketEvent>(
    _type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ) {
    this.msg.delete(listener as AnyListener);
    this.recon.delete(listener as AnyListener);
  }

  // test drivers
  deliver(data: FromRemote) {
    const event = { data } as Parameters<AnyListener>[1];
    for (const listener of [...this.msg]) listener(this as never, event);
  }
  fireReconnect() {
    this.connectionState = WebsocketConnectionState.Open;
    const event = {} as Parameters<AnyListener>[1];
    for (const listener of [...this.recon]) listener(this as never, event);
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
  update: (update: Uint8Array) =>
    ({
      ...GUARDS,
      isRemoteUpdate: () => true,
      value: { update },
    }) as unknown as FromRemote,
  awareness: (awareness: Uint8Array) =>
    ({
      ...GUARDS,
      isRemoteAwareness: () => true,
      value: { awareness },
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
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('SyncServiceSource', () => {
  it('resolves doInitialSync and starts heartbeat on RemoteInitialSync', async () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    const pending = src.doInitialSync();
    ws.deliver(remote.initialSync(snap, aw));
    expect((await pending)._unsafeUnwrap()).toEqual({
      snapshot: snap,
      awareness: aw,
    });
    expect(ws.heartbeats).toBe(1);
  });

  it('maps RemoteUpdate to an update event', () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    const events: SyncSourceEvent[] = [];
    src.listen((e) => events.push(e));
    const bytes = new Uint8Array([9]);
    ws.deliver(remote.update(bytes));
    expect(events).toEqual([{ type: 'update', update: bytes }]);
  });

  it('buffers events that arrive before the first listener attaches', () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    const bytes = new Uint8Array([7]);
    ws.deliver(remote.update(bytes)); // no listener yet
    const events: SyncSourceEvent[] = [];
    src.listen((e) => events.push(e));
    expect(events).toEqual([{ type: 'update', update: bytes }]);
  });

  it('pushUpdate resolves false before initial sync', async () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    expect(await src.pushUpdate([new Uint8Array([1])])).toBe(false);
  });

  it('pushUpdate resolves true when a matching ack arrives', async () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1', { newId: () => 'id-1' });
    ws.deliver(remote.initialSync(snap, aw));
    await src.doInitialSync();

    const acked = src.pushUpdate([new Uint8Array([1])]);
    expect(ws.sent).toHaveLength(1); // the FromPeer update went out
    ws.deliver(remote.ack('id-1'));
    expect(await acked).toBe(true);
  });

  it('pushUpdate resolves false when the ack times out', async () => {
    vi.useFakeTimers();
    try {
      const ws = new FakeSocket();
      const src = new SyncServiceSource(ws, 'doc1', { newId: () => 'id-1' });
      ws.deliver(remote.initialSync(snap, aw));
      await src.doInitialSync();

      const acked = src.pushUpdate([new Uint8Array([1])]);
      await vi.advanceTimersByTimeAsync(TIMEOUTS.ACK + 1);
      expect(await acked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches concurrent acks to the right pushUpdate, even out of order', async () => {
    let n = 0;
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1', { newId: () => `id-${++n}` });
    ws.deliver(remote.initialSync(snap, aw));
    await src.doInitialSync();

    const first = src.pushUpdate([new Uint8Array([1])]); // id-1
    const second = src.pushUpdate([new Uint8Array([2])]); // id-2
    ws.deliver(remote.ack('id-2')); // ack the second one first
    ws.deliver(remote.ack('id-1'));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it('pushAwareness sends only while the socket is open', () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');

    ws.connectionState = WebsocketConnectionState.Reconnecting;
    src.pushAwareness(new Uint8Array([1]));
    expect(ws.sent).toHaveLength(0); // dropped while not open

    ws.connectionState = WebsocketConnectionState.Open;
    src.pushAwareness(new Uint8Array([2]));
    expect(ws.sent).toHaveLength(1); // sent once open
  });

  it('requestSnapshot resolves with the snapshot bytes', async () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    const pending = src.requestSnapshot();
    const bytes = new Uint8Array([42]);
    ws.deliver(remote.snapshot(bytes));
    expect((await pending)._unsafeUnwrap()).toEqual(bytes);
  });

  it('re-syncs and emits reconnect after a Reconnect event', async () => {
    const ws = new FakeSocket();
    const src = new SyncServiceSource(ws, 'doc1');
    const events: SyncSourceEvent[] = [];
    src.listen((e) => events.push(e));

    ws.fireReconnect();
    expect(ws.heartbeats).toBe(1); // heartbeat restarted on reconnect
    ws.deliver(remote.initialSync(snap, aw));
    await flush();

    expect(events).toContainEqual({
      type: 'reconnect',
      snapshot: snap,
      awareness: aw,
    });
  });
});
