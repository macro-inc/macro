import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Listens for heartbeat pings from the native side.
 * On iOS, the content process can be killed when the app is backgrounded.
 * On resume, the native side emits a "heartbeat_ping" event to check if
 * the JS context is still alive. If this listener responds, the native side
 * knows the webview is healthy. If not, it reloads the webview.
 */
export function listenForHeartbeat() {
  listen('heartbeat_ping', () => {
    invoke('heartbeat_response');
  });
}
