/// <reference lib="webworker" />

import { startDetached } from '@core/util/startDetached';
import type { CacheEngineRuntimeEvent } from '../cache-engine-runtime';

let channel: BroadcastChannel | undefined;
let activationStartedAt = 0;
let nestedWorkerConstructions = 0;
let wasmFetchCount = 0;
let wasmSha256: Promise<string> | undefined;

async function sha256Hex(response: Response): Promise<string> {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (...argumentsList: Parameters<typeof fetch>) => {
  const response = await nativeFetch(...argumentsList);
  const input = argumentsList[0];
  const requestUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (/\/cache_wasm_bg(?:-[\w-]+)?\.wasm(?:[?#]|$)/.test(requestUrl)) {
    wasmFetchCount++;
    wasmSha256 = sha256Hex(response.clone());
  }
  return response;
};

const WorkerConstructor = globalThis.Worker;
if (typeof WorkerConstructor === 'function') {
  globalThis.Worker = new Proxy(WorkerConstructor, {
    construct() {
      nestedWorkerConstructions++;
      throw new Error('nested cache worker construction is forbidden');
    },
  });
}

// An uncaught error reaches the page's worker `error` listener; a rejection does not.
const failWorker = (error: unknown): void => {
  setTimeout(() => {
    throw error;
  });
};

const report = async (event: CacheEngineRuntimeEvent): Promise<void> => {
  channel ??= new BroadcastChannel(
    `graphql-cache-performance:${event.activation.scope}`
  );
  if (event.kind === 'activation-started') {
    activationStartedAt = performance.now();
    channel.postMessage({
      kind: 'activation-started',
      ownerEpoch: event.activation.ownerEpoch,
    });
  }
  if (event.kind === 'ready') {
    const { cacheWasmLinearMemoryBytes } = await import('../wasm-module');
    if (!wasmSha256) {
      throw new Error('cache WASM fetch was not observed before DB readiness');
    }
    channel.postMessage({
      kind: 'database-ready',
      ownerEpoch: event.activation.ownerEpoch,
      workerActivationMs: performance.now() - activationStartedAt,
      linearMemoryBytes: cacheWasmLinearMemoryBytes(),
      wasmFetchCount,
      wasmSha256: await wasmSha256,
      nestedWorkerConstructions,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      sharedArrayBufferAvailable:
        typeof globalThis.SharedArrayBuffer === 'function',
    });
  }
};

// Install interception before evaluating any production runtime module so a
// future static-import constructor cannot run outside this measurement guard.
// Top-level-await permits activation delivery during the dynamic import, so
// buffer those envelopes until the production runtime owns `onmessage`.
const bufferedActivationEvents: MessageEvent<unknown>[] = [];
globalThis.onmessage = (event: MessageEvent<unknown>) => {
  bufferedActivationEvents.push(event);
};
const { installCacheEngineWorker } = await import('../cache-engine-runtime');
installCacheEngineWorker({
  hooks: {
    onEvent: (event) => {
      startDetached(report(event), failWorker);
    },
  },
});
for (const event of bufferedActivationEvents) {
  globalThis.dispatchEvent(event);
}
