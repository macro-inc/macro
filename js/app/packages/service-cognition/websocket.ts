import { useIsAuthenticated } from '@core/auth';
import { createBlockEffect, inBlock } from '@core/block';
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { getMacroApiToken } from '@service-auth/fetch';
import { createCallback } from '@solid-primitives/rootless';
// import {
//   authPlugin,
//   createDurableSocket,
//   createSocketEffect,
//   createWSState,
//   heartbeatPlugin,
//   jsonPlugin,
// } from '@websocket/index';
import type { Accessor } from 'solid-js';
import { createRoot, createSignal } from 'solid-js';
import type { StreamError } from './generated/schemas';
import type { FromWebSocketMessage } from './generated/schemas/fromWebSocketMessage';
import type { ToWebSocketMessage } from './generated/schemas/toWebSocketMessage';
import { JsonSerializer } from '@websocket/serializers/json-serializer';
import { ConstantBackoff, WebsocketBuilder } from '@websocket';
import { createWebsocketStateSignal } from '@websocket/solid/state-signal';
import { createSocketEffect } from '@websocket/solid/socket-effect';

export type { StreamError, FromWebSocketMessage, ToWebSocketMessage };

/**
 * Current state of the websocket connection
 * WebSocket.CONNECTING = 0
 * WebSocket.OPEN = 1
 * WebSocket.CLOSING = 2
 * WebSocket.CLOSED = 3
 */
export enum WebSocketState {
  Connecting = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
}

const wsHost: string = SERVER_HOSTS['cognition-websocket-service'];

async function resolveWsUrl() {
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const apiToken = await getMacroApiToken();
    if (!apiToken) throw new Error('No Macro API token');
    return `${wsHost}/?macro-api-token=${apiToken}`;
  }
  await fetchToken();
  return wsHost;
}

// export const ws = createDurableSocket<ToWebSocketMessage, FromWebSocketMessage>(
//   wsHost,
//   {
//     backoffStrategy: 'linear',
//     delay: 500,
//     reconnectUrlResolver: async () => {
//       if (ENABLE_BEARER_TOKEN_AUTH) {
//         const apiToken = await getMacroApiToken();
//         if (!apiToken) throw new Error('No Macro API token');
//
//         return `${wsHost}/?macro-api-token=${apiToken}`;
//       }
//       await fetchToken();
//       return wsHost;
//     },
//   },
//   [
//     authPlugin({
//       isAuthenticated: () => {
//         const isAuth = useIsAuthenticated();
//         return isAuth() ?? false;
//       },
//     }),
//     heartbeatPlugin({ interval: 25_000 }),
//     jsonPlugin<ToWebSocketMessage, FromWebSocketMessage>(),
//   ]
// );

export const ws = new WebsocketBuilder(resolveWsUrl)
  .withSerializer(
    new JsonSerializer<ToWebSocketMessage, FromWebSocketMessage>()
  )
  .withBackoff(new ConstantBackoff(500))
  .withHeartbeat({
    interval: 1_000,
    timeout: 1_000,
    pingMessage: 'ping',
    pongMessage: 'pong',
    maxMissedHeartbeats: 3,
  })
  .build();

export const state = createWebsocketStateSignal(ws);

export function createCognitionWebsocketBlockEffect<
  T extends FromWebSocketMessage['type'],
>(
  type: T,
  callback: (data: Extract<FromWebSocketMessage, { type: T }>) => void
) {
  createBlockEffect(() => {
    const wrappedCallback = createCallback((data: FromWebSocketMessage) => {
      if (data.type === type) {
        return inBlock(callback)(
          data as Extract<FromWebSocketMessage, { type: T }>
        );
      }
    });
    createSocketEffect(ws, wrappedCallback);
  });
}

/** Creates a typed DCS websocket effect scoped to any owner context.
 *  Returns a dispose function that should be used to remove the effect.
 */
export function createCognitionWebsocketEffect<
  T extends FromWebSocketMessage['type'],
>(
  type: T,
  callback: (data: Extract<FromWebSocketMessage, { type: T }>) => void
) {
  const wrappedCallback = createCallback((data: FromWebSocketMessage) => {
    if (data.type === type) {
      return callback(data as any);
    }
  });
  const dispose = createSocketEffect(ws, wrappedCallback);
  return dispose;
}

type WithStreamId<T> = T extends { stream_id?: string } ? T : never;

type Send = WithStreamId<ToWebSocketMessage>;
export type StreamItem = FromWebSocketMessage;

export type WebsocketError = Extract<FromWebSocketMessage, { type: 'error' }>;

// export type MessageStream = AsyncGenerator<Receive | WebsocketError>;
// export type MessageStream = Accessor<StreamType>;
export interface MessageStream {
  // list of messages from ws (you probably want to concat these)
  data: Accessor<StreamItem[]>;
  isDone: Accessor<boolean>;
  // errors will show up in the data list
  isErr: Accessor<boolean>; // this will stop updating the data accessor + cleanup (this makes no guarantee about the server side connection)
  err: Accessor<StreamError | undefined>;
  close: () => void;
  request: Send;
}

export function createMessageStream(send: Send): MessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal<boolean>(false);
  const [isErr, setIsErr] = createSignal<boolean>(false);
  const [err, setErr] = createSignal<StreamError>();

  let cleanup = () => {};

  const handleMessage = (data: FromWebSocketMessage) => {
    if (isDone()) return;
    // not a stream message
    if (typeof data !== 'object') return;
    if (!('stream_id' in data)) return;
    if (data.stream_id !== send.stream_id) return;
    if (data.type === 'stream_end') {
      setIsDone(true);
      cleanup();
    } else if (data.type === 'error' && data.error_type === 'stream_error') {
      setErr(data);
      setIsErr(true);
      setIsDone(true);
      cleanup();
    } else {
      setMessages((p) => [...p, data]);
    }
  };

  createRoot((dispose) => {
    createSocketEffect(ws, handleMessage);
    cleanup = dispose;
  });

  const setClosed = () => {
    setIsDone(true);
    cleanup();
  };

  ws.send(send);

  return {
    close: setClosed,
    data: messages,
    isDone,
    isErr,
    err,
    request: send,
  };
}

/** Sends a message to the dcs websocket */
export function sendCognitionWebsocketMessage(message: ToWebSocketMessage) {
  ws.send(message);
}
