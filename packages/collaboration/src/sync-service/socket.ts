import {
  ArrayQueue,
  BebopSerializer,
  ExponentialBackoff,
  type UrlResolver,
  type WebSocketFactory,
  type Websocket,
  WebsocketBuilder,
  type WebsocketConnectionState,
  type WebsocketEvent,
  type WebsocketEventListener,
  type WebsocketSerializer,
} from '../websocket';
import { FromPeer, FromRemote, type IFromPeer } from './generated/schema';

/** The concrete sync websocket: a {@link Websocket} speaking the Bebop protocol. */
export type SyncWebsocket = Websocket<IFromPeer, FromRemote>;

/**
 * Simple websocket interface that we use for our syncing abstractions.
 */
export interface SyncSocket {
  connectionState: WebsocketConnectionState;
  send(message: IFromPeer): boolean;
  startHeartbeat(): void;
  reconnectIfDisconnected(): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void;
  removeEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, IFromPeer, FromRemote>
  ): void;
}

/**
 * Builds a sync websocket configured the way every caller wants it: Bebop
 * serializer, capped exponential backoff, send buffer, and a manually-started
 * heartbeat. The `getUrl` resolver is the only environment-specific bit — the
 * browser refreshes a permission token on each (re)connect, the worker returns
 * a static URL.
 *
 * `factory` optionally overrides how the underlying native socket is created
 * (the AI editing worker wraps the default to observe raw frames).
 *
 * `serializer` optionally overrides the default Bebop serializer (the AI
 * editing worker wraps it to survive frames that fail to deserialize).
 */
export function createSyncSocket(
  getUrl: UrlResolver,
  factory?: WebSocketFactory,
  serializer?: WebsocketSerializer<IFromPeer, FromRemote>
): SyncWebsocket {
  let builder = new WebsocketBuilder(getUrl).withSerializer(
    serializer ?? new BebopSerializer(FromPeer, FromRemote)
  );
  if (factory) builder = builder.withFactory(factory);
  return (
    builder
      // Capped exponential backoff. The scheduler calls next() before the first
      // retry, so the delays are 250*2^1 = 500ms doubling to a 250*2^5 = 8s
      // cap; 20 retries ≈ 2 minutes of automatic attempts, after which
      // something is very wrong and we stop hammering. A given-up socket is
      // revived by 'online' / 'visibilitychange' signals or by the user editing
      // (see pushUpdate) — unlike before, exhausting the budget no longer
      // strands the socket permanently.
      .withBackoff(new ExponentialBackoff(250, 5))
      .withMaxRetries(20)
      // Queue messages sent while disconnected; they are flushed in order once
      // the connection is re-established, so edits made during a reconnect
      // aren't dropped. Unbounded on purpose: dropping the oldest updates would
      // leave dependency gaps the server can never fill, and CRDT updates are
      // tiny relative to a session's lifetime.
      .withBuffer(new ArrayQueue())
      .withHeartbeat({
        interval: 10_000,
        timeout: 5_000,
        pingMessage: 'ping',
        pongMessage: 'pong',
        maxMissedHeartbeats: 2,
        autoStart: false, // Start heartbeat manually after initial sync completes
      })
      .build()
  );
}
