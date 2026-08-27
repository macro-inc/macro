import { isPlatform } from '@core/util/platform';
import { Channel, invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';

/** Reachability reported by the native platform monitor. */
export type NativeNetworkStatus = 'unknown' | 'online' | 'offline';

type NetworkStatusPayload = {
  status: NativeNetworkStatus;
};

/** Message carried by aborts and load errors caused by a missing network path. */
export const NATIVE_OFFLINE_ERROR_MESSAGE = 'Native network path unavailable';

const WATCH_START_ATTEMPTS = 3;
const WATCH_START_RETRY_DELAY_MS = 1_000;

const [nativeNetworkStatus, setNativeNetworkStatus] =
  createSignal<NativeNetworkStatus>('unknown');

let networkAbortController = new AbortController();
let statusChannel: Channel<NetworkStatusPayload> | undefined;
let initialization: Promise<void> | undefined;
const listeners = new Set<(status: NativeNetworkStatus) => void>();

function isNetworkStatus(value: unknown): value is NativeNetworkStatus {
  return value === 'unknown' || value === 'online' || value === 'offline';
}

function applyStatus(payload: NetworkStatusPayload): void {
  if (!isNetworkStatus(payload.status)) {
    console.error(
      '[network-status] ignored invalid native status',
      payload.status
    );
    return;
  }

  const status = payload.status;
  if (status === nativeNetworkStatus()) return;

  if (status === 'offline') {
    networkAbortController.abort(new Error(NATIVE_OFFLINE_ERROR_MESSAGE));
  } else if (status === 'online' && networkAbortController.signal.aborted) {
    networkAbortController = new AbortController();
  }

  setNativeNetworkStatus(status);
  for (const listener of listeners) listener(status);
}

/** Current native reachability state. Remains `unknown` off iOS. */
export { nativeNetworkStatus };

/** Signal aborted whenever iOS reports that no network path is available. */
export function getNativeNetworkAbortSignal(): AbortSignal {
  return networkAbortController.signal;
}

/** Subscribes to native reachability changes for imperative consumers. */
export function subscribeNativeNetworkStatus(
  listener: (status: NativeNetworkStatus) => void
): () => void {
  listeners.add(listener);
  listener(nativeNetworkStatus());
  return () => listeners.delete(listener);
}

/** Starts the singleton iOS `NWPathMonitor` channel. */
export function initializeNativeNetworkStatus(): Promise<void> {
  if (!isPlatform('ios')) return Promise.resolve();
  if (!initialization) initialization = startNativeMonitor();
  return initialization;
}

async function startNativeMonitor(): Promise<void> {
  for (let attempt = 1; attempt <= WATCH_START_ATTEMPTS; attempt += 1) {
    statusChannel = new Channel<NetworkStatusPayload>(applyStatus);
    try {
      await invoke<void>('plugin:network-status|watch_status', {
        channel: statusChannel,
      });
      return;
    } catch (error) {
      statusChannel = undefined;
      if (attempt === WATCH_START_ATTEMPTS) {
        // Fail open: status stays 'unknown' and offline aborts never engage
        // this session, matching the browser-connectivity behavior off iOS.
        initialization = undefined;
        console.error('[network-status] failed to start native monitor', error);
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, WATCH_START_RETRY_DELAY_MS * attempt)
      );
    }
  }
}
