import { isTauri } from '@core/util/platform';
import { browserWebSocketFactory } from './minimal-websocket';
import { tauriWebSocketFactory } from './tauri-websocket';

export function platformFactory() {
  if (isTauri()) {
    return tauriWebSocketFactory;
  }

  return browserWebSocketFactory;
}
