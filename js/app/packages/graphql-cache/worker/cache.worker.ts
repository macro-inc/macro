/**
 * Dedicated-worker entry: fallback topology when SharedWorker is
 * unavailable. One engine per tab over the shared IndexedDB database;
 * writes serialized via Web Locks; cross-tab invalidation over
 * BroadcastChannel (handled inside CacheWorkerCore).
 */

import type { CacheRequest } from '../protocol';
import { CacheWorkerCore } from './worker-core';

declare const self: DedicatedWorkerGlobalScope;

const core = new CacheWorkerCore({ multiEngine: true });
core.addPort(self);

self.onmessage = (msg: MessageEvent<CacheRequest>) => {
  void core.handleRequest(self, msg.data);
};
