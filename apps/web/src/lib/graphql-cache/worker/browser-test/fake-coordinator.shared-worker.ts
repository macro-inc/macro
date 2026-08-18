/// <reference lib="webworker" />

import { CoordinatorRouter } from '../coordinator-router';

declare const self: SharedWorkerGlobalScope;

const router = new CoordinatorRouter();
let telemetry: BroadcastChannel | undefined;

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (port) router.connect(port);
};

setInterval(() => {
  const snapshot = router.snapshot();
  if (!snapshot) return;
  telemetry ??= new BroadcastChannel(`graphql-cache-wp08:${snapshot.scope}`);
  telemetry.postMessage({
    kind: 'coordinator-snapshot',
    ownerEpoch: snapshot.ownerEpoch,
    snapshot,
  });
}, 100);
