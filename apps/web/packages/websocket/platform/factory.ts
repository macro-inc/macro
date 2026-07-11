import { isTauri } from '@core/util/platform';
import {
  browserWebSocketFactory,
  type WebSocketFactory,
} from './minimal-websocket';
import { tauriWebSocketFactory } from './tauri-websocket';

/**
 * Dynamic WebSocket factory that returns the right websocket wrapper
 * depending on the platform
 */
export const platformWebSocketFactory: WebSocketFactory = (url, protocols) => {
  if (isTauri()) {
    return tauriWebSocketFactory(url, protocols);
  }

  return browserWebSocketFactory(url, protocols);
};
