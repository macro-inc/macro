import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Registers a permanent listener for heartbeat pings from the native side.
 *
 * This listener is intentionally never cleaned up — it must remain active
 * for the entire app lifecycle to respond to resume pings.
 */
export function listenForHeartbeat() {
  listen('heartbeat_ping', () => {
    invoke('heartbeat_response');
  });
}
