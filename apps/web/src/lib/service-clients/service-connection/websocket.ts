import { createBlockEffect, inBlock } from '@core/block';
import {
  ArrayQueue,
  createSocketEffect,
  JsonSerializer,
  LinearBackoff,
  type Websocket,
  WebsocketBuilder,
} from '@macro-inc/collaboration/websocket';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { createCallback } from '@solid-primitives/rootless';
import type { ToWebsocketMessage } from './generated/schemas/toWebsocketMessage';
import { instrumentGatewaySocket } from './presence-telemetry';
import { resolveWsUrl } from './websocket-url';

export { parseWebsocketPayload } from './websocket-payload';

export type ConnectionGatewayWebsocket = Websocket<
  ToWebsocketMessage,
  FromWebsocketMessage
>;

export type FromWebsocketMessage = {
  type: string;
  data: any;
};

export const ws = new WebsocketBuilder(resolveWsUrl)
  .withSerializer(
    new JsonSerializer<ToWebsocketMessage, FromWebsocketMessage>()
  )
  .withBuffer(new ArrayQueue())
  .withBackoff(new LinearBackoff(500, 500))
  .withMaxRetries(20)
  .withHeartbeat({
    interval: 1_000,
    timeout: 1_000,
    pingMessage: 'ping',
    pongMessage: 'pong',
    maxMissedHeartbeats: 3,
  })
  .build();

instrumentGatewaySocket(ws);

function reconnectIfDisconnected() {
  ws.reconnectIfDisconnected();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    reconnectIfDisconnected();
  }
}

// When the browser regains connectivity or a background tab becomes visible,
// kick the connection immediately instead of waiting for heartbeat/backoff
// timers, which may have been throttled while the tab was stale.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', reconnectIfDisconnected);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

export const state = createWebsocketStateSignal(ws);
// TODO: add type mapping on the websocket event
export function createConnectionBlockWebsocketEffect(
  callback: (data: FromWebsocketMessage) => void
) {
  createBlockEffect(() => {
    const wrappedCallback = createCallback((data) => {
      return inBlock(callback)(data);
    });
    createSocketEffect(ws, wrappedCallback);
  });
}

export function createConnectionWebsocketEffect(
  callback: (data: FromWebsocketMessage) => void
) {
  createSocketEffect(ws, callback);
}
