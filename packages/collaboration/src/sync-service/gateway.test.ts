import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { WebsocketEvent } from '../websocket';
import { intoFrames, Reassembler } from '../websocket/platform/framing';
import { GatewaySyncTransport } from './gateway';
import { FromPeer, FromRemote, FromRouter, ToRouter } from './generated/schema';
import type { SyncSocket } from './socket';

describe('gateway document transport', () => {
  let server: WebSocketServer;
  let transport: GatewaySyncTransport;
  let peer: WebSocket;
  let received: ToRouter[];
  let sockets: SyncSocket[];

  beforeEach(async () => {
    received = [];
    sockets = [];
    server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    server.on('connection', (socket) => {
      peer = socket;
      socket.on('message', (bytes) => {
        received.push(ToRouter.decode(new Uint8Array(bytes as Buffer)));
      });
    });
    const port = (server.address() as AddressInfo).port;
    transport = new GatewaySyncTransport(`ws://127.0.0.1:${port}`);
  });

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    transport.socket().close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function attach(
    id: string,
    token: string | undefined,
    refresh = async () => 'fresh'
  ) {
    const socket = transport.attach(id, token, refresh);
    sockets.push(socket);
    return socket;
  }

  async function subscribed(id: string) {
    await vi.waitFor(() =>
      expect(
        received.some(
          (message) => message.isRouterSubscribe() && message.value.docId === id
        )
      ).toBe(true)
    );
    peer.send(
      FromRouter.encode(FromRouter.fromRouterSubscribed({ docId: id }))
    );
  }

  test('multiplexes documents and reassembles their interleaved downstream chunks', async () => {
    const a = attach('a', 'token');
    const b = attach('b', 'token');
    const seenA: FromRemote[] = [];
    const seenB: FromRemote[] = [];
    a.addEventListener(WebsocketEvent.Message, (_, event) =>
      seenA.push(event.data)
    );
    b.addEventListener(WebsocketEvent.Message, (_, event) =>
      seenB.push(event.data)
    );
    await subscribed('a');
    await subscribed('b');
    const message = FromRemote.fromRemoteSnapshot({
      snapshot: new Uint8Array([4, 5, 6]),
    });
    for (const payload of intoFrames(FromRemote.encode(message), 3)) {
      for (const docId of ['a', 'b']) {
        peer.send(
          FromRouter.encode(FromRouter.fromRouterDocFrame({ docId, payload }))
        );
      }
    }
    await vi.waitFor(() => {
      expect(seenA).toHaveLength(1);
      expect(seenB).toHaveLength(1);
    });
    expect(seenA[0]).toEqual(message);
    expect(seenB[0]).toEqual(message);
    expect(server.clients.size).toBe(1);
  });

  test('waits for fresh authorization and subscription before sending framed edits', async () => {
    const grant = Promise.withResolvers<string>();
    const socket = attach('doc', undefined, () => grant.promise);
    const update = FromPeer.fromPeerUpdate({
      id: 'edit',
      updates: [new Uint8Array(900_010)],
    });
    socket.send(update);
    expect(received).toEqual([]);
    grant.resolve('fresh-grant');
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual(
      ToRouter.fromRouterSubscribe({ docId: 'doc', token: 'fresh-grant' })
    );
    await subscribed('doc');
    await vi.waitFor(() => expect(received).toHaveLength(3));
    const reassembler = new Reassembler();
    let complete: Uint8Array | null = null;
    for (const message of received.slice(1)) {
      expect(message.isRouterFrame()).toBe(true);
      if (message.isRouterFrame())
        complete = reassembler.push(message.value.payload);
    }
    expect(complete).not.toBeNull();
    const decoded = FromPeer.decode(complete!);
    expect(decoded.isPeerUpdate()).toBe(true);
    if (decoded.isPeerUpdate()) {
      expect(decoded.value.id).toBe('edit');
      expect(decoded.value.updates).toHaveLength(1);
      expect(
        Buffer.from(decoded.value.updates[0]).equals(Buffer.alloc(900_010))
      ).toBe(true);
    }
  });

  test('retries a failed initial token refresh', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('fresh');
    attach('doc', undefined, refresh);
    await vi.waitFor(() => expect(received).toHaveLength(1), {
      timeout: 2_000,
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(received[0]).toEqual(
      ToRouter.fromRouterSubscribe({ docId: 'doc', token: 'fresh' })
    );
  });

  test('does not subscribe after the document is disposed during authorization', async () => {
    const grant = Promise.withResolvers<string>();
    const socket = attach('doc', undefined, () => grant.promise);
    socket.close();
    grant.resolve('stale');
    await grant.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(received).toEqual([]);
  });
});
