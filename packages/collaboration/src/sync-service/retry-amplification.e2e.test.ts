import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type RawData,
  type WebSocket as ServerWebSocket,
  WebSocketServer,
} from 'ws';
import type { RawUpdate } from '../collab/shared';
import { InMemoryWALStore, WALSyncer } from '../collab/wal';
import { WebsocketConnectionState } from '../websocket';
import { FromPeer, FromRemote } from './generated/schema';
import { createSyncSocket, type SyncWebsocket } from './socket';
import { SyncServiceSource } from './source';

const ACK_TIMEOUT_MS = 75;
const STALE_RETRIES = 3;

type ReceivedUpdate = {
  id: string;
  updates: Uint8Array[];
};

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function sendInitialSync(ws: ServerWebSocket): void {
  ws.send(
    FromRemote.encode(
      FromRemote.fromRemoteInitialSync({
        snapshot: new Uint8Array(),
        awareness: new Uint8Array(),
      })
    )
  );
}

function handleServerConnection(
  ws: ServerWebSocket,
  received: ReceivedUpdate[],
  acknowledgeUpdates: boolean
): void {
  sendInitialSync(ws);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      if (data.toString() === 'ping') ws.send('pong');
      return;
    }

    const message = FromPeer.decode(bytes(data));
    if (!message.isPeerUpdate()) return;

    received.push({
      id: message.value.id,
      updates: message.value.updates,
    });

    if (acknowledgeUpdates) {
      ws.send(
        FromRemote.encode(
          FromRemote.fromRemoteUpdateAck({ id: message.value.id })
        )
      );
    }
  });
}

async function startServer(
  port: number,
  received: ReceivedUpdate[],
  acknowledgeUpdates: boolean
): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  server.on('connection', (ws) =>
    handleServerConnection(ws, received, acknowledgeUpdates)
  );
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  return server;
}

async function stopServer(server: WebSocketServer | undefined): Promise<void> {
  if (!server) return;
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('sync retry amplification', () => {
  let server: WebSocketServer | undefined;
  let socket: SyncWebsocket | undefined;
  let source: SyncServiceSource | undefined;

  afterEach(async () => {
    source?.cleanup();
    await stopServer(server);
  });

  test('reconnect drains every timed-out WAL retry before sending a fresh copy', async () => {
    const received: ReceivedUpdate[] = [];
    server = await startServer(0, received, false);
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const url = `ws://127.0.0.1:${port}`;

    socket = createSyncSocket(url);
    let nextId = 0;
    source = new SyncServiceSource(socket, 'amplification-repro', {
      ackTimeoutMs: ACK_TIMEOUT_MS,
      newId: () => `update-${++nextId}`,
    });
    await source.doInitialSync().match(
      () => undefined,
      (error) => {
        throw error;
      }
    );

    await stopServer(server);
    server = undefined;
    await vi.waitFor(() => {
      expect(socket!.connectionState).not.toBe(WebsocketConnectionState.Open);
    });

    const store = new InMemoryWALStore<RawUpdate>();
    const wal = new WALSyncer<RawUpdate>(
      store,
      (updates) => source!.pushUpdate(updates),
      'amplification-repro'
    );
    const removeReconnectListener = source.listen((event) => {
      if (event.type === 'reconnect') void wal.flush();
    });
    wal.addCleanup(removeReconnectListener);

    const update = new Uint8Array([1, 2, 3, 4]);
    await wal.append(update);
    await wal.pendingFlush;
    for (let retry = 1; retry < STALE_RETRIES; retry++) {
      await wal.flush();
    }

    expect(received).toHaveLength(0);
    expect(
      (await store.getAll()).filter((entry) => !entry.delivered)
    ).toHaveLength(1);

    server = await startServer(port, received, true);

    await vi.waitFor(
      async () => {
        expect(received).toHaveLength(STALE_RETRIES + 1);
        expect(
          (await store.getAll()).filter((entry) => !entry.delivered)
        ).toHaveLength(0);
      },
      { timeout: 5_000 }
    );

    // Every send is the same single WAL entry under a distinct message id:
    // the stale retries drained plus one fresh copy, and nothing more — a
    // regression that re-amplified retries would push extra messages here.
    expect(received).toHaveLength(STALE_RETRIES + 1);
    expect(new Set(received.map(({ id }) => id)).size).toBe(STALE_RETRIES + 1);
    for (const message of received) {
      expect(message.updates).toEqual([update]);
    }

    wal.destroy();
  }, 10_000);
});
