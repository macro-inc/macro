import { useIsAuthenticated } from '@core/auth';
import { createBlockEffect, inBlock } from '@core/block';
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchToken } from '@core/util/fetchWithToken';
import { getMacroApiToken } from '@service-auth/fetch';
import { createCallback } from '@solid-primitives/rootless';
import {
  authPlugin,
  createDurableSocket,
  createSocketEffect,
  createWSState,
  heartbeatPlugin,
  jsonPlugin,
} from '@websocket/index';
import type { ToWebsocketMessage } from './generated/schemas/toWebsocketMessage';

const wsHost: string = SERVER_HOSTS['connection-gateway'];

const isAuthenticated = useIsAuthenticated();

export type FromWebsocketMessage = {
  type: string;
  data: any;
};

export const ws = createDurableSocket<ToWebsocketMessage, FromWebsocketMessage>(
  wsHost,
  {
    backoffStrategy: 'linear',
    delay: 500,
    reconnectUrlResolver: async () => {
      if (ENABLE_BEARER_TOKEN_AUTH) {
        const apiToken = await getMacroApiToken();
        if (!apiToken) throw new Error('No Macro API token');

        return `${wsHost}/?macro-api-token=${apiToken}`;
      }
      await fetchToken();
      return wsHost;
    },
  },
  [
    authPlugin({
      isAuthenticated: () => isAuthenticated() ?? false,
    }),
    heartbeatPlugin({ interval: 25_000 }),
    jsonPlugin<ToWebsocketMessage, FromWebsocketMessage>(),
  ]
);

export const state = createWSState(ws);

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
