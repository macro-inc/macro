/**
 * SharedWorker entry: one engine shared by every tab (preferred topology).
 */

import type { CacheRequest } from '../protocol';
import { CacheWorkerCore } from './worker-core';

declare const self: SharedWorkerGlobalScope;

const core = new CacheWorkerCore({ multiEngine: false });

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;
  core.addPort(port);
  port.onmessage = (msg: MessageEvent<CacheRequest>) => {
    void core.handleRequest(port, msg.data);
  };
  port.start();
};
