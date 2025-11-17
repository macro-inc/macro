import { createBlockEffect, inBlock } from '@core/block';
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { getMacroApiToken } from '@service-auth/fetch';
import { createCallback } from '@solid-primitives/rootless';
import {
  createSocketEffect,
  JsonSerializer,
  LinearBackoff,
  type Websocket,
  WebsocketBuilder,
} from '@websocket';
import { createWebsocketStateSignal } from '@websocket/solid/state-signal';
import type { ToWebsocketMessage } from './generated/schemas/toWebsocketMessage';

const wsHost: string = SERVER_HOSTS['connection-gateway'];

export type ConnectionGatewayWebsocket = Websocket<
  ToWebsocketMessage,
  FromWebsocketMessage
>;

export type FromWebsocketMessage = {
  type: string;
  data: any;
};

async function resolveWsUrl() {
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const apiToken = await getMacroApiToken();
    if (!apiToken) throw new Error('No Macro API token');

    return `${wsHost}/?macro-api-token=${apiToken}`;
  }
  await fetchToken();
  return wsHost;
}

export const ws = new WebsocketBuilder(resolveWsUrl)
  .withSerializer(
    new JsonSerializer<ToWebsocketMessage, FromWebsocketMessage>()
  )
  .withBackoff(new LinearBackoff(500, 500))
  .withHeartbeat({
    interval: 1_000,
    timeout: 1_000,
    pingMessage: 'ping',
    pongMessage: 'pong',
    maxMissedHeartbeats: 3,
  })
  .build();

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
