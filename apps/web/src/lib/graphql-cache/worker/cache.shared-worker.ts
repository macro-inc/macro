/**
 * SharedWorker entry: one engine shared by every tab (preferred topology).
 */

import {
  type CacheNotice,
  type CacheRequest,
  isCacheNotice,
} from '../protocol';
import { CacheWorkerCore } from './worker-core';

declare const self: SharedWorkerGlobalScope;

const core = new CacheWorkerCore({ multiEngine: false });

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;
  core.addPort(port);
  port.onmessage = (msg: MessageEvent<CacheRequest | CacheNotice>) => {
    // Clients announce disconnection (dispose/pagehide) — there is no
    // platform event for it, and unpruned ports would accumulate.
    if (isCacheNotice(msg.data)) {
      core.removePort(port);
      port.close();
      return;
    }
    void core.handleRequest(port, msg.data);
  };
  port.start();
};
