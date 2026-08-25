import { Channel, invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import { isPlatform } from '../util/platform';

/** Reachability reported by the native platform monitor. */
export type NativeNetworkStatus = 'unknown' | 'online' | 'offline';

type NetworkStatusPayload = {
  status: NativeNetworkStatus;
};

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
    console.error('[network-status] ignored invalid native status');
    return;
  }

  const status = payload.status;
  if (status === nativeNetworkStatus()) return;

  if (status === 'offline') {
    networkAbortController.abort(new Error('Native network path unavailable'));
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
  if (initialization) return initialization;

  statusChannel = new Channel<NetworkStatusPayload>(applyStatus);
  const started = invoke<void>('plugin:network-status|watch_status', {
    channel: statusChannel,
  }).catch((error) => {
    initialization = undefined;
    statusChannel = undefined;
    console.error('[network-status] failed to start native monitor', error);
  });
  initialization = started;

  return started;
}
